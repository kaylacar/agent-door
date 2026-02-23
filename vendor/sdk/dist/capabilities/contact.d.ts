import { CapabilityDefinition } from '../types';
interface ContactOptions {
    handler: (message: {
        name: string;
        email: string;
        message: string;
    }) => Promise<void>;
}
export declare function contact({ handler }: ContactOptions): CapabilityDefinition;
export {};
