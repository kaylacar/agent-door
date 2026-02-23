export declare class RateLimiter {
    private windows;
    private cleanupInterval;
    private windowMs;
    constructor();
    checkRateLimit(key: string, limit: number): {
        allowed: boolean;
        remaining: number;
        resetAt: number;
    };
    private cleanup;
    destroy(): void;
}
