// Verifies the Supabase access token (Bearer). Projects on the legacy HS256 secret set
// SUPABASE_JWT_SECRET; projects on asymmetric signing keys verify against the project JWKS.
import type { RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { getEnv } from '../config/env';
import { AppError } from './error';

type Verifier = (token: string) => Promise<JWTPayload>;

let verifier: Verifier | undefined;

function getVerifier(): Verifier {
  if (!verifier) {
    const env = getEnv();
    const issuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
    const options = { issuer, audience: 'authenticated' };
    if (env.SUPABASE_JWT_SECRET) {
      const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      verifier = async (token) => (await jwtVerify(token, secret, options)).payload;
    } else {
      const jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
      verifier = async (token) => (await jwtVerify(token, jwks, options)).payload;
    }
  }
  return verifier;
}

/** For tests: replace token verification. */
export function setTokenVerifier(custom: Verifier | undefined): void {
  verifier = custom;
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  if (!match?.[1]) {
    next(new AppError('UNAUTHORIZED', 'Missing bearer token'));
    return;
  }

  try {
    const claims = await getVerifier()(match[1]);
    if (typeof claims.sub !== 'string' || claims.role !== 'authenticated') {
      throw new Error('Not a user access token');
    }
    req.auth = {
      userId: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      claims: claims as Record<string, unknown>,
      accessToken: match[1],
    };
    next();
  } catch {
    next(new AppError('UNAUTHORIZED', 'Invalid or expired token'));
  }
};
