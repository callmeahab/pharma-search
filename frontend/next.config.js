/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const backend = process.env.CATALOG_API_URL || "http://127.0.0.1:50051";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/service.PharmaAPI/:path*", destination: `${backend}/service.PharmaAPI/:path*` },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
