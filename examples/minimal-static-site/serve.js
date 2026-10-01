// Tiny static server for the example site. Any static server works.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("./site/", import.meta.url).pathname;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css" };
createServer(async (req, res) => {
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname);
  const file = join(root, path === "/" ? "index.html" : path);
  try {
    res.writeHead(200, { "content-type": types[extname(file)] ?? "text/plain" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(8080, "127.0.0.1", () => console.log("http://127.0.0.1:8080"));
