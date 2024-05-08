import { Context, Env, Hono } from "hono";
import {todos} from "./data.json";
import { Ratelimit } from "@upstash/ratelimit";
import { BlankInput } from "hono/types";
import { env } from "hono/adapter";
import { Redis } from "@upstash/redis/cloudflare";

declare module "hono"  {
 interface ContextVariableMap{
    ratelimit: Ratelimit;
 }
};

const app = new Hono;

const cache = new Map();

class RedisRateLimiter {
  static instance: Ratelimit
  static getInstance(c: Context<Env, "todos/:id", BlankInput>){
    if(!this.instance) {
      const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env<{
        UPSTASH_REDIS_REST_URL: string,
        UPSTASH_REDIS_REST_TOKEN: string
      }>(c);
      
      const redisClient = new Redis({
        token: UPSTASH_REDIS_REST_TOKEN,
        url: UPSTASH_REDIS_REST_URL,
      });

      const ratelimit = new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(10, "10s"),
        ephemeralCache: cache
      });

      this.instance = ratelimit;
      return this.instance;

    } else {
      return this.instance;
    };
  };
};

app.use(async (c, next) => {
  const ratelimit = RedisRateLimiter.getInstance(c);
  c.set("ratelimit", ratelimit);
  await next();
});

app.get("/todos/:id",async (c) => {
  const ratelimit = c.get("ratelimit")

  const ip = c.req.raw.headers.get("CF-Connecting-IP");

  const { success } = await ratelimit.limit(ip ?? "anonymous")

  if(success) {
    const todoId = c.req.param("id");
    const todoIndex = Number(todoId);
    const todo = todos[todoIndex] || {};
    return c.json(todo); 
  } else {
    return c.json({message: 'Too many request'}, {status: 429})
  }

});

export default app;