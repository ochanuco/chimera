-- claim した worker の release 版 (hello の version)。
ALTER TABLE requests ADD COLUMN worker_version TEXT;
