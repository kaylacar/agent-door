declare const app: import("express-serve-static-core").Express;
declare function isPrivateIP(ip: string): boolean;
declare function isPublicUrl(raw: string): boolean;
declare function resolveAndValidateUrl(raw: string): Promise<boolean>;
declare function timingSafeEqual(a: string, b: string): boolean;
declare function startServer(): import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
export { app, startServer, isPublicUrl, resolveAndValidateUrl, isPrivateIP, timingSafeEqual };
//# sourceMappingURL=server.d.ts.map