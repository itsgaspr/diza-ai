import { createServer, type Server } from "node:http";

export function startPing(port: number): Server {
  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0];
    if (request.method === "GET" && (path === "/ping" || path === "/")) {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`diza has been active since ${formatUptime(process.uptime())} ago. 🌸\n`);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("no\n");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[diza] ping em http://0.0.0.0:${port}/ping`);
  });
  server.on("error", (error: Error) => {
    console.error(`[diza] ping não subiu: ${error.message}`);
  });
  return server;
}

function formatUptime(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}
