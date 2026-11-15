// supertest client acting as a user: Bearer token on every call, a fresh Idempotency-Key on every
// mutation unless the test passes its own (to exercise replays).
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request, { type Test } from 'supertest';
import { createApp } from '../../../src/app';

let app: Express | undefined;

export function testApp(): Express {
  app ??= createApp();
  return app;
}

type Body = string | object | undefined;

export interface AsUser {
  get(path: string): Test;
  post(path: string, body?: Body, idempotencyKey?: string): Test;
  put(path: string, body?: Body, idempotencyKey?: string): Test;
  patch(path: string, body?: Body, idempotencyKey?: string): Test;
  delete(path: string, idempotencyKey?: string): Test;
}

const api = (path: string) => `/api/v1${path}`;

export function as(token: string): AsUser {
  const agent = request(testApp());
  const auth = (t: Test) => t.set('Authorization', `Bearer ${token}`);
  const mutate = (t: Test, key?: string) => auth(t).set('Idempotency-Key', key ?? randomUUID());
  return {
    get: (path) => auth(agent.get(api(path))),
    post: (path, body, key) => mutate(agent.post(api(path)), key).send(body),
    put: (path, body, key) => mutate(agent.put(api(path)), key).send(body),
    patch: (path, body, key) => mutate(agent.patch(api(path)), key).send(body),
    delete: (path, key) => mutate(agent.delete(api(path)), key),
  };
}
