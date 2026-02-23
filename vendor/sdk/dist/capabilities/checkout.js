"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkout = checkout;
function checkout({ onCheckout }) {
    return {
        name: 'checkout',
        description: 'Generate a checkout URL for human completion',
        method: 'POST',
        requiresSession: true,
        humanHandoff: true,
        handler: async (_req, session) => {
            const items = session.cartItems;
            if (items.length === 0)
                throw new Error('Cart is empty');
            const result = await onCheckout(items);
            return { checkout_url: result.checkout_url, human_handoff: true };
        },
    };
}
