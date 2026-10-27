-- claim した worker のビルド (hello の version、無ければ短い commit)。
ALTER TABLE requests ADD COLUMN worker_version TEXT;
