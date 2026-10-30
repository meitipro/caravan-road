import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@caravan/shared"],
  webpack(cfg) {
    // @caravan/shared imports its own files with a ".js" suffix (NodeNext style) while the
    // sources are ".ts"; let webpack resolve both.
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return cfg;
  },
};

export default config;
