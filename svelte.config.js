import adapter from '@sveltejs/adapter-static';
export default {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: null
    }),
    paths: {
      base: '/speedcoach-web'   // ★ リポジトリ名（サブフォルダ公開用）
    }
  }
};