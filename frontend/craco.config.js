const path = require("path");
const { EsbuildPlugin } = require("esbuild-loader");

module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    configure: (webpackConfig) => {
      // Swap the slow Terser JS minifier for esbuild (much faster). The CSS
      // minimizer (CssMinimizerPlugin) is kept as-is.
      if (webpackConfig.optimization && Array.isArray(webpackConfig.optimization.minimizer)) {
        webpackConfig.optimization.minimizer = webpackConfig.optimization.minimizer.map((m) =>
          m && m.constructor && m.constructor.name === "TerserPlugin"
            ? new EsbuildPlugin({ target: "es2015" })
            : m
        );
      }
      return webpackConfig;
    },
  },
};
