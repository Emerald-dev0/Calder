// Keep this entry tracked: Vercel discovers api/ functions before building.
// The build bundles workspace TypeScript into plain Node-compatible ESM.
export { default, maxDuration } from "../dist/serverless.js";
