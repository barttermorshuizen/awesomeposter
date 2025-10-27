# Flex API CORS Checklist

We've hit the same CORS failure on `GET /api/v1/flex/tasks` multiple times. The fix mirrors what already works for the run stream/resume endpoints:

1. **Dedicated `.options.ts` handler**  
   Add `packages/flex-agents-server/routes/api/v1/flex/tasks.options.ts` that echoes the browser's `Access-Control-Request-Headers`, enables credentials, and sets the exposed headers.

   ```ts
   const origin = getHeader(event, 'origin')
   if (origin) {
     setHeader(event, 'Vary', 'Origin')
     setHeader(event, 'Access-Control-Allow-Origin', origin)
     setHeader(event, 'Access-Control-Allow-Credentials', 'true')
   }
   const requested = getHeader(event, 'access-control-request-headers')
   setHeader(event, 'Access-Control-Allow-Headers', requested || 'content-type,accept,authorization,x-correlation-id')
   setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')
   setHeader(event, 'Access-Control-Allow-Methods', 'GET,OPTIONS')
   setHeader(event, 'Access-Control-Max-Age', '600')
   ```

2. **Keep `tasks.get.ts` focused on the GET**  
   - It should no longer special-case OPTIONS.  
   - Still mirrors the same header/expose settings for the actual response.

3. **Client fetch**  
   Build headers inline (lower-case keys) and pass them straight to `fetch`. Do not force `credentials` or `mode` unless the server needs them.

With this structure the preflight succeeds, matching the behaviour of the existing flex endpoints, and the browser stops blocking the task fetch. Next time the flow fails CORS, check that the route has a twin `.options.ts` file wired exactly like above.***
