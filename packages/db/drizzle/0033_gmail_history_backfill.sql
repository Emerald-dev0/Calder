-- Legacy records have project attribution but not a reliable Gmail-account
-- identifier. Attribute a pinned sender to its transport; when attribution is
-- missing, conservatively count the message against each Gmail account in the
-- project. created_at is an approximation of provider handoff time.
INSERT INTO gmail_send_attempts (id, account_hash, attempted_at)
SELECT 'legacy_' || e.id || '_' || t.id,
       encode(sha256(convert_to(lower(trim(t.label)), 'UTF8')), 'hex'),
       e.created_at
FROM emails e
JOIN project_transports t ON t.project_id = e.project_id AND t.type = 'gmail'
LEFT JOIN sender_identities s ON s.id = e.sender_identity_id AND s.project_id = e.project_id
WHERE e.transport = 'gmail' AND e.status IN ('sent', 'delivered', 'bounced', 'complained')
  AND (s.transport_id IS NULL OR s.transport_id = t.id)
ON CONFLICT (id) DO NOTHING;
