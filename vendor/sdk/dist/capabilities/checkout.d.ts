import { CapabilityDefinition, CartItem } from '../types';
interface CheckoutOptions {
    onCheckout: (cart: CartItem[]) => Promise<{
        checkout_url: string;
    }>;
}
export declare function checkout({ onCheckout }: CheckoutOptions): CapabilityDefinition;
export {};
