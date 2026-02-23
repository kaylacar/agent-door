"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browse = browse;
function browse({ handler }) {
    return {
        name: 'browse',
        description: 'Browse items with pagination and filtering',
        method: 'GET',
        params: {
            page: { type: 'number', required: false, description: 'Page number' },
            limit: { type: 'number', required: false, description: 'Items per page' },
            category: { type: 'string', required: false, description: 'Filter by category' },
        },
        handler: async (req) => {
            const page = req.query.page ? parseInt(req.query.page, 10) : undefined;
            const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
            const category = req.query.category;
            const { page: _p, limit: _l, category: _c, ...filters } = req.query;
            return handler({ page, limit, category, filters });
        },
    };
}
