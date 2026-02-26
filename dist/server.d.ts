declare const app: import("express-serve-static-core").Express;
declare function isPrivateIP(ip: string): boolean;
declare function isPublicUrl(raw: string): boolean;
declare function resolveAndValidateUrl(raw: string): Promise<boolean>;
declare function startServer(): import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
export { app, startServer, isPublicUrl, resolveAndValidateUrl, isPrivateIP };
//# sourceMappingURL=server.d.ts.map