import { Layout } from '../layout';

export function NotFoundPage({ what }: { what: string }) {
  return (
    <Layout title="見つかりません">
      <h1>見つかりません</h1>
      <p>{what} が見つかりません。</p>
    </Layout>
  );
}
