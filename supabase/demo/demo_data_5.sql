begin;
set local session_replication_role = replica;
SELECT pg_catalog.setval('public.audit_logs_id_seq', 176, true);
SELECT pg_catalog.setval('public.student_code_seq', 1, true);
commit;
