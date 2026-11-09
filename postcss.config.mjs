// Webpack 빌드용 Tailwind 설정 (Turbopack은 next.config.ts의 turbopack.rules를 사용)
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
