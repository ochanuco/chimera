import { Layout } from '../layout';

export function NotFoundPage({ what }: { what: string }) {
  return (
    <Layout title="Not found">
      <h1>Not found</h1>
      <p>{what} was not found.</p>
    </Layout>
  );
}
