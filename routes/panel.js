const router = require('express').Router();
const panelAuth = require('../middleware/panelAuth');
const { getQuery, query } = require('../db');
const { buildAnalysePayload } = require('./lib/panelAnalytics');
const { rowToPanelUser, panelPatchToDbFields } = require('./lib/panelUserMapper');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

router.use(panelAuth);

router.get('/health', (req, res) => {
    res.status(200).json({
        ok: true,
        service: 'friendfy-panel-api',
        contractVersion: '2'
    });
});

router.get('/analyse', async (req, res) => {
    try {
        const payload = await buildAnalysePayload();
        return res.status(200).json(payload);
    } catch (error) {
        console.error('panel /analyse error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

router.get('/users', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
        );
        const offset = (page - 1) * limit;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        let whereSql = '';
        const countParams = [];
        const listParams = [];

        if (search) {
            whereSql = ' WHERE email LIKE ? OR username LIKE ? OR phoneNumber LIKE ? ';
            const like = `%${search}%`;
            countParams.push(like, like, like);
            listParams.push(like, like, like);
        }

        const [countRow] = await getQuery(
            `SELECT COUNT(*) AS total FROM \`users\`${whereSql}`,
            countParams
        );
        const total = Number(countRow?.total) || 0;

        const rows = await getQuery(
            `SELECT * FROM \`users\`${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [...listParams, limit, offset]
        );

        const users = (rows || []).map(rowToPanelUser).filter(Boolean);
        const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

        return res.status(200).json({
            contractVersion: '2',
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('panel GET /users error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

router.get('/users/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const rows = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [id]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                ok: false,
                msg: 'User not found'
            });
        }
        return res.status(200).json({
            contractVersion: '2',
            user: rowToPanelUser(rows[0])
        });
    } catch (error) {
        console.error('panel GET /users/:id error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

router.patch('/users/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body || {};

        const rows = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [id]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                ok: false,
                msg: 'User not found'
            });
        }

        const existing = rows[0];
        const { fields, values } = panelPatchToDbFields(existing, body);

        if (fields.length === 0) {
            return res.status(400).json({
                ok: false,
                msg: 'No supported fields to update'
            });
        }

        if (body.email !== undefined && body.email !== null) {
            const dup = await getQuery(
                'SELECT id FROM `users` WHERE email = ? AND id != ? LIMIT 1',
                [body.email, id]
            );
            if (dup && dup.length > 0) {
                return res.status(409).json({
                    ok: false,
                    code: 'EMAIL_IN_USE',
                    msg: 'Email already registered'
                });
            }
        }

        const sql = `UPDATE \`users\` SET ${fields.join(', ')} WHERE id = ? LIMIT 1`;
        const ok = await query(sql, [...values, id]);
        if (!ok) {
            return res.status(500).json({
                ok: false,
                msg: 'Update failed'
            });
        }

        const updated = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [id]);
        return res.status(200).json({
            contractVersion: '2',
            ok: true,
            user: rowToPanelUser(updated[0])
        });
    } catch (error) {
        console.error('panel PATCH /users/:id error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

module.exports = router;
