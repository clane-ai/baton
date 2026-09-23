-- Artefact kinds for business processes that are not software delivery: the procure-to-pay example
-- (docs/examples/workflows/p2p). Enum values must be committed before use; schemas follow in the next migration.
alter type baton.artifact_kind add value if not exists 'purchase_order';
alter type baton.artifact_kind add value if not exists 'delivery_note';
alter type baton.artifact_kind add value if not exists 'invoice';
alter type baton.artifact_kind add value if not exists 'goods_receipt';
alter type baton.artifact_kind add value if not exists 'invoice_match';
alter type baton.artifact_kind add value if not exists 'payment';
