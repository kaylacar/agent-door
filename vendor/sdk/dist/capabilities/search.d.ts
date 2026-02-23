import { CapabilityDefinition } from '../types';
interface SearchOptions {
    handler: (query: string, options?: {
        limit?: number;
    }) => Promise<any[]>;
}
export declare function search({ handler }: SearchOptions): CapabilityDefinition;
export {};
