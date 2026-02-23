import { CapabilityDefinition } from '../types';
interface BrowseOptions {
    handler: (options?: {
        page?: number;
        limit?: number;
        category?: string;
        filters?: Record<string, string>;
    }) => Promise<{
        items: any[];
        total: number;
    }>;
}
export declare function browse({ handler }: BrowseOptions): CapabilityDefinition;
export {};
