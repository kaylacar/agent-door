import { CapabilityDefinition } from '../types';
interface DetailOptions {
    handler: (id: string) => Promise<any>;
}
export declare function detail({ handler }: DetailOptions): CapabilityDefinition;
export {};
