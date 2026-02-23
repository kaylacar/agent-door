"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cart = cart;
function cart() {
    const add = {
        name: 'cart.add',
        description: 'Add an item to the cart',
        method: 'POST',
        requiresSession: true,
        params: {
            item_id: { type: 'string', required: true, description: 'Item ID to add' },
            quantity: { type: 'number', required: true, description: 'Quantity to add' },
            name: { type: 'string', required: false, description: 'Item name' },
            price: { type: 'number', required: false, description: 'Item price' },
        },
        handler: async (req, session) => {
            const { item_id, quantity, name, price } = req.body;
            if (!item_id || quantity == null) {
                throw new Error('Missing required parameters: item_id, quantity');
            }
            const existing = session.cartItems.find(i => i.itemId === item_id);
            if (existing) {
                existing.quantity += quantity;
                if (name)
                    existing.name = name;
                if (price != null)
                    existing.price = price;
            }
            else {
                const item = { itemId: item_id, quantity };
                if (name)
                    item.name = name;
                if (price != null)
                    item.price = price;
                session.cartItems.push(item);
            }
            return { item_id, quantity: existing?.quantity ?? quantity, cart_size: session.cartItems.length };
        },
    };
    const view = {
        name: 'cart.view',
        description: 'View current cart contents',
        method: 'GET',
        requiresSession: true,
        handler: async (_req, session) => {
            const items = session.cartItems;
            const subtotal = items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
            return { items, subtotal };
        },
    };
    const update = {
        name: 'cart.update',
        description: 'Update the quantity of a cart item',
        method: 'PUT',
        requiresSession: true,
        params: {
            item_id: { type: 'string', required: true, description: 'Item ID to update' },
            quantity: { type: 'number', required: true, description: 'New quantity' },
        },
        handler: async (req, session) => {
            const { item_id, quantity } = req.body;
            if (!item_id || quantity == null) {
                throw new Error('Missing required parameters: item_id, quantity');
            }
            const item = session.cartItems.find(i => i.itemId === item_id);
            if (!item)
                throw new Error(`Item not found in cart: ${item_id}`);
            item.quantity = quantity;
            return { item_id, quantity };
        },
    };
    const remove = {
        name: 'cart.remove',
        description: 'Remove an item from the cart',
        method: 'DELETE',
        requiresSession: true,
        params: {
            item_id: { type: 'string', required: true, description: 'Item ID to remove' },
        },
        handler: async (req, session) => {
            const item_id = req.body?.item_id || req.query.item_id;
            if (!item_id)
                throw new Error('Missing required parameter: item_id');
            const index = session.cartItems.findIndex(i => i.itemId === item_id);
            if (index === -1)
                throw new Error(`Item not found in cart: ${item_id}`);
            session.cartItems.splice(index, 1);
            return { item_id, removed: true };
        },
    };
    return [add, view, update, remove];
}
