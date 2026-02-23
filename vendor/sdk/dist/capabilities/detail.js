"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detail = detail;
function detail({ handler }) {
    return {
        name: 'detail',
        description: 'Get detailed information about a specific item',
        method: 'GET',
        params: {
            id: { type: 'string', required: true, description: 'Item identifier' },
        },
        handler: async (req) => {
            const id = req.params.id ?? req.query.id;
            if (!id)
                throw new Error('Missing required parameter: id');
            return handler(id);
        },
    };
}
