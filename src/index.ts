import { Elysia } from "elysia";
import { authRoute } from "./auth";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { context } from "./context";

const app = new Elysia()
  .use(
    cors({
      origin: "http://localhost:3000",
      preflight: true,
      credentials: true,
    }),
  )
  .use(context)
  .onStop(({ log }) => {
    if (log) {
      log.info("Server stopped");
    }
  })
  .onError(({ log, error }) => {
    if (log) {
      log.error(error);
    }
  })
  .get("/", () => "Hello Elysia")
  .use(authRoute)
  .use(swagger({ path: "/swagger" }))
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

const routes = app.routes
  .sort((a, b) => a.path.localeCompare(b.path))
  .map((r, i) =>
    i === 0 ? "\t" + r.method + "\t" + r.path : r.method + "\t" + r.path,
  );
console.info("   Available paths\n", routes.join("\n\t"));
