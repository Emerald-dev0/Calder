import pkg from "/home/emerald/Desktop/Avenor/node_modules/.pnpm/@aws-sdk+client-sesv2@3.1127.0/node_modules/@aws-sdk/client-sesv2/dist-cjs/index.js";
const { 
  SESv2Client, 
  CreateConfigurationSetCommand,
  PutConfigurationSetDeliveryOptionsCommand,
  PutConfigurationSetReputationOptionsCommand,
  PutConfigurationSetSendingOptionsCommand,
  PutConfigurationSetTrackingOptionsCommand,
  CreateConfigurationSetEventDestinationCommand,
  GetConfigurationSetCommand,
  ListConfigurationSetsCommand,
  Tag
} = pkg;

const client = new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });

const TRANSACTIONAL_CONFIG_SET = "calder-transactional";
const BROADCAST_CONFIG_SET = "calder-broadcast";

// Event types for transactional config set
const TRANSACTIONAL_EVENTS = [
  "SEND",
  "DELIVERY", 
  "BOUNCE",
  "COMPLAINT",
  "REJECT",
  "DELIVERY_DELAY"
];

// Event types for broadcast config set (includes open/click)
const BROADCAST_EVENTS = [
  "SEND",
  "DELIVERY",
  "BOUNCE", 
  "COMPLAINT",
  "REJECT",
  "DELIVERY_DELAY",
  "OPEN",
  "CLICK"
];

async function createConfigSet(name, eventTypes, snsTopicArn) {
  console.log(`\n=== Creating config set: ${name} ===`);
  
  // 1. Create the configuration set
  try {
    await client.send(new CreateConfigurationSetCommand({
      ConfigurationSetName: name,
      Tags: [
        { Key: "Project", Value: "Calder" },
        { Key: "Environment", Value: process.env.NODE_ENV ?? "development" }
      ]
    }));
    console.log(`  Created: ${name}`);
  } catch (e) {
    if (e.name === "AlreadyExistsException" || e.message.includes("already exists")) {
      console.log(`  Already exists: ${name}`);
    } else {
      throw e;
    }
  }

  // 2. Enable reputation metrics
  await client.send(new PutConfigurationSetReputationOptionsCommand({
    ConfigurationSetName: name,
    ReputationMetricsEnabled: true
  }));
  console.log(`  Reputation metrics enabled`);

  // 3. Enable sending
  await client.send(new PutConfigurationSetSendingOptionsCommand({
    ConfigurationSetName: name,
    SendingEnabled: true
  }));
  console.log(`  Sending enabled`);

  // 4. Delivery options (for TLS requirement)
  await client.send(new PutConfigurationSetDeliveryOptionsCommand({
    ConfigurationSetName: name,
    TlsPolicy: "OPTIONAL"
  }));
  console.log(`  TLS policy: OPTIONAL`);

  // 5. Tracking options (for open/click tracking with custom domain)
  await client.send(new PutConfigurationSetTrackingOptionsCommand({
    ConfigurationSetName: name,
    CustomRedirectDomain: process.env.TRACKING_BASE_URL?.replace(/^https?:\/\//, "") ?? "track.calder.click"
  }));
  console.log(`  Tracking domain configured`);

  // 6. Create event destinations for each event type
  if (snsTopicArn) {
    for (const eventType of eventTypes) {
      try {
        await client.send(new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: name,
          EventDestinationName: eventType.toLowerCase(),
          EventDestination: {
            Enabled: true,
            MatchingEventTypes: [eventType],
            SnsDestination: {
              TopicArn: snsTopicArn
            }
          }
        }));
        console.log(`  Event destination: ${eventType} -> SNS`);
      } catch (e) {
        if (e.name === "AlreadyExistsException" || e.message.includes("already exists")) {
          console.log(`  Event destination ${eventType}: already exists`);
        } else {
          console.error(`  Failed to create ${eventType}:`, e.message);
        }
      }
    }
  } else {
    console.log(`  SKIPPED event destinations: SES_SNS_TOPIC_ARNS not set`);
  }
}

async function main() {
  const snsTopicArn = process.env.SES_SNS_TOPIC_ARNS?.split(",")[0]?.trim();
  
  console.log("=== SES CONFIGURATION SET SETUP ===");
  console.log("Region:", process.env.AWS_REGION ?? "us-east-1");
  console.log("SNS Topic ARN:", snsTopicArn || "NOT SET (event destinations will be skipped)");
  
  if (!snsTopicArn) {
    console.log("\nWARNING: SES_SNS_TOPIC_ARNS not set. Event destinations will not be created.");
    console.log("Set SES_SNS_TOPIC_ARNS environment variable to enable event destinations.");
  }

  try {
    await createConfigSet(TRANSACTIONAL_CONFIG_SET, TRANSACTIONAL_EVENTS, snsTopicArn);
    await createConfigSet(BROADCAST_CONFIG_SET, BROADCAST_EVENTS, snsTopicArn);
    
    console.log("\n=== SETUP COMPLETE ===");
    console.log("Created/verified:");
    console.log(`  - ${TRANSACTIONAL_CONFIG_SET}: ${TRANSACTIONAL_EVENTS.join(", ")}`);
    console.log(`  - ${BROADCAST_CONFIG_SET}: ${BROADCAST_EVENTS.join(", ")}`);
    console.log("\nNext steps:");
    console.log("1. Set SES_CONFIGURATION_SET=calder-transactional (or calder-broadcast for broadcast sends)");
    console.log("2. Set SES_SNS_TOPIC_ARNS to your SNS topic ARN for event destinations");
    console.log("3. Set TRACKING_BASE_URL for click/open tracking domain");
    
  } catch (e) {
    console.error("Setup failed:", e);
    process.exit(1);
  }
}

main().catch(console.error);