import Elysia, { t } from "elysia";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";
import { lucia } from "lucia";
import { elysia } from "lucia/middleware";
import { betterSqlite3 } from "@lucia-auth/adapter-sqlite";
import { dbConnection } from "./db";
import { context } from "./context";
import { list, todo } from "./schema";
import { and, eq, getTableColumns } from "drizzle-orm";

const listInsert = createInsertSchema(list);
const listSelect = createSelectSchema(list);

const todoInsert = createInsertSchema(todo);
const todoSelect = createSelectSchema(todo);

export const auth = lucia({
  adapter: betterSqlite3(dbConnection, {
    key: "user_key",
    session: "user_session",
    user: "user",
  }),
  env: "DEV",
  middleware: elysia(),
  getUserAttributes(databaseUser) {
    return {
      username: databaseUser.username,
    };
  },
});

export const authRoute = new Elysia()
  .use(context)
  .decorate("auth", auth)
  .derive(async (ctx) => {
    const authRequest = ctx.auth.handleRequest(ctx);
    const session = await authRequest.validate();

    return { session };
  })
  .model(
    "auth",
    t.Object({
      username: t.String({ maxLength: 20, minLength: 4 }),
      password: t.String({ maxLength: 50, minLength: 8 }),
    }),
  )
  .model("todo", t.Omit(todoSelect, ["userId"]))
  .model(
    "list",
    t.Array(
      t.Intersect([
        t.Omit(listSelect, ["userId"]),
        t.Object({ todos: t.Array(t.Omit(todoSelect, ["userId"])) }),
      ]),
    ),
  )
  .post(
    "/sign-up",
    async (ctx) => {
      const user = await auth
        .createUser({
          key: {
            providerId: "username",
            providerUserId: ctx.body.username.toLowerCase(),
            password: ctx.body.password,
          },
          attributes: { username: ctx.body.username },
        })
        .catch((err) => {
          if (err.code === "SQLITE_CONSTRAINT") {
            throw ctx.HttpError.BadRequest("Duplicate Username");
          }

          throw err;
        });

      const session = await auth.createSession({
        userId: user.userId,
        attributes: {},
      });
      const authRequest = ctx.auth.handleRequest(ctx);
      authRequest.setSession(session);

      ctx.set.status = ctx.httpStatus.HTTP_204_NO_CONTENT;
      ctx.set.headers.Location = "/";
    },
    { body: "auth", detail: { tags: ["Auth"] } },
  )
  .post(
    "/sign-in",
    async (ctx) => {
      const user = await ctx.auth.useKey(
        "username",
        ctx.body.username.toLowerCase(),
        ctx.body.password,
      );
      const session = await auth.createSession({
        userId: user.userId,
        attributes: {},
      });
      const authRequest = ctx.auth.handleRequest(ctx);
      authRequest.setSession(session);
      ctx.set.headers.Location = "/";
      ctx.set.status = ctx.httpStatus.HTTP_204_NO_CONTENT;
    },
    { body: "auth", detail: { tags: ["Auth"] } },
  )
  .post(
    "/list",
    ({ db, session, HttpError, body }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }
      const { userId: _, ...newList } = db
        .insert(list)
        .values({ ...body, userId: session.user.userId })
        .returning()
        .get();

      return newList;
    },
    {
      body: t.Omit(listInsert, ["id", "userId", "createdAt", "modifiedAt"]),
      response: t.Omit(listSelect, ["userId"]),
      detail: { tags: ["List"] },
    },
  )
  .post(
    "/todo",
    ({ db, session, HttpError, body }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      const newTodo = db
        .insert(todo)
        .values({ ...body, userId: session.user.userId })
        .returning()
        .get();

      return newTodo;
    },
    {
      body: t.Omit(todoInsert, ["id", "userId", "createdAt", "modifiedAt"]),
      response: t.Omit(todoSelect, ["userId"]),
      detail: { tags: ["Todo"] },
    },
  )
  .patch(
    "/list",
    ({ HttpError, session, db, body }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      const listUpdated = db
        .update(list)
        .set({ ...body, modifiedAt: new Date() })
        .where(and(eq(list.userId, session.user.userId), eq(list.id, body.id)))
        .returning()
        .get();

      return listUpdated;
    },
    {
      body: t.Omit(listSelect, ["userId", "createdAt", "modifiedAt"]),
      response: t.Omit(listSelect, ["userId"]),
      detail: { tags: ["List"] },
    },
  )
  .patch(
    "/todo",
    ({ HttpError, session, db, body }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      const todoUpdated = db
        .update(todo)
        .set({ ...body, modifiedAt: new Date() })
        .where(and(eq(todo.userId, session.user.userId), eq(todo.id, body.id)))
        .returning()
        .get();

      return todoUpdated;
    },
    {
      body: t.Omit(todoSelect, ["userId", "createdAt", "modifiedAt"]),
      response: t.Omit(todoSelect, ["userId"]),
      detail: { tags: ["Todo"] },
    },
  )
  .get(
    "/lists",
    ({ db, session, HttpError }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      const lists = db.query.list
        .findMany({
          where: (list, { eq }) => eq(list.userId, session.user.userId),
          columns: { userId: false },
          with: { todos: { columns: { userId: false } } },
        })
        .sync();

      return lists;
    },
    {
      response: "list",
      detail: { tags: ["List"] },
    },
  )
  .get(
    "/list/:id",
    ({ db, session, HttpError, params: { id } }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      const listTarget = db.query.list
        .findMany({
          where: (list, { eq, and }) =>
            and(eq(list.userId, session.user.userId), eq(list.id, id)),
          columns: { userId: false },
          with: { todos: { columns: { userId: false } } },
          limit: 1,
        })
        .sync()
        .at(0);

      if (!listTarget) {
        throw HttpError.NotFound("List not found");
      }

      return listTarget;
    },
    {
      params: t.Object({ id: t.String() }),
      response: "list",
      detail: { tags: ["List"] },
    },
  )
  .get(
    "/todo/:id",
    ({ HttpError, db, session, params: { id } }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      const { userId: _, ...todoCols } = getTableColumns(todo);
      const todoTarget = db
        .select({ ...todoCols })
        .from(todo)
        .where(and(eq(todo.userId, session.user.userId), eq(todo.id, id)))
        .limit(1)
        .get();

      if (!todoTarget) {
        throw HttpError.NotFound("Todo not found.");
      }

      return todoTarget;
    },
    {
      params: t.Object({ id: t.String() }),
      response: "todo",
      detail: { tags: ["Todo"] },
    },
  )
  .delete(
    "/todo/:id",
    ({ db, params: { id }, session, set, httpStatus, HttpError }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      db.delete(todo).where(eq(todo.id, id)).get();
      set.status = httpStatus.HTTP_204_NO_CONTENT;
    },
    { params: t.Object({ id: t.String() }), detail: { tags: ["Todo"] } },
  )
  .delete(
    "/list/:id",
    ({ db, params: { id }, session, set, httpStatus, HttpError }) => {
      if (!session) {
        throw HttpError.Unauthorized("Please login frist.");
      }

      db.delete(list).where(eq(list.id, id)).get();
      set.status = httpStatus.HTTP_204_NO_CONTENT;
    },
    { params: t.Object({ id: t.String() }), detail: { tags: ["List"] } },
  );

export type Auth = typeof auth;
