"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contact = contact;
function contact({ handler }) {
    return {
        name: 'contact',
        description: 'Send a contact message',
        method: 'POST',
        params: {
            name: { type: 'string', required: true, description: 'Sender name' },
            email: { type: 'string', required: true, description: 'Sender email' },
            message: { type: 'string', required: true, description: 'Message content' },
        },
        handler: async (req) => {
            const { name, email, message } = req.body;
            if (!name || !email || !message) {
                throw new Error('Missing required parameters: name, email, message');
            }
            await handler({ name, email, message });
            return { sent: true };
        },
    };
}
