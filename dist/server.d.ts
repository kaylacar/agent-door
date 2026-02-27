import { Registry } from './registry';
declare function isPrivateIP(ip: string): boolean;
declare function isPublicUrl(raw: string): boolean;
declare function resolveAndValidateUrl(raw: string): Promise<boolean>;
declare function timingSafeEqual(a: string, b: string): boolean;
declare const registerWindow: Map<string, number[]>;
declare function checkRegisterRate(ip: string): boolean;
export interface CreateAppOptions {
    dbPath?: string;
}
export declare function createApp(options?: CreateAppOptions): {
    app: import("express-serve-static-core").Express;
    registry: Registry;
    startServer: () => import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
};
export { isPublicUrl, resolveAndValidateUrl, isPrivateIP, timingSafeEqual, checkRegisterRate, registerWindow };
//# sourceMappingURL=server.d.ts.map