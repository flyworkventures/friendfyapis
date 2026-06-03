const router = require('express').Router();
const middleware = require('../middleware/checkAuth');
const { getQuery, query } = require('../db');
const {
    normalizeMembership,
    mergeMembershipsDbWithClient,
    normalizeDeviceFingerprint,
    hashDeviceFingerprint,
    parseMembershipsArray,
    buildDeviceFreeTrialMembership,
    replaceServerDeviceTrial,
    DEVICE_TRIAL_PRODUCT_ID
} = require('./lib/membershipsSync');
const { assertJwtMatchesUserId, normalizeUserId } = require('./lib/assertJwtUserId');
const {
    pickRevenueCatCustomerId,
    persistRevenueCatCustomerId
} = require('./lib/revenuecatCustomerLink');

router.post('/claim-free-trial', middleware, async (req, res) => {
    try {
        const { userId, deviceTrialFingerprint } = req.body || {};
        const fpRaw =
            deviceTrialFingerprint ??
            req.body?.device_trial_fingerprint ??
            req.body?.deviceFingerprint;

        const gate = assertJwtMatchesUserId(req, userId);
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }

        const fpNorm = normalizeDeviceFingerprint(fpRaw);
        const fpHash = hashDeviceFingerprint(fpNorm);
        if (!fpHash) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_DEVICE_FINGERPRINT',
                msg: 'deviceTrialFingerprint is required (min 8 chars after trim)'
            });
        }

        const rows = await getQuery(
            'SELECT user_id FROM `device_trial_claims` WHERE fingerprint_hash = ? LIMIT 1',
            [fpHash]
        );

        if (rows && rows.length > 0) {
            const owner = normalizeUserId(rows[0].user_id);
            if (owner !== gate.jwtUserId) {
                return res.status(409).json({
                    success: false,
                    trialNotAllowed: true,
                    code: 'DEVICE_TRIAL_ALREADY_USED',
                    msg: 'This device has already been used for a free trial'
                });
            }
            const userAgain = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [
                userId
            ]);
            return res.status(200).json({
                success: true,
                alreadyClaimed: true,
                user: userAgain?.[0] || null
            });
        }

        const users = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [userId]);
        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                msg: 'User not found'
            });
        }

        const userRow = users[0];
        const trial = buildDeviceFreeTrialMembership();
        const dbArr = parseMembershipsArray(userRow.memberships);
        const mergedArr = replaceServerDeviceTrial(dbArr, trial);
        const membershipsJson = JSON.stringify(mergedArr);

        const insertOk = await query(
            'INSERT INTO `device_trial_claims` (fingerprint_hash, user_id, granted_at) VALUES (?, ?, NOW())',
            [fpHash, gate.jwtUserId]
        );

        if (!insertOk) {
            const again = await getQuery(
                'SELECT user_id FROM `device_trial_claims` WHERE fingerprint_hash = ? LIMIT 1',
                [fpHash]
            );
            if (again?.length) {
                const owner = normalizeUserId(again[0].user_id);
                if (owner !== gate.jwtUserId) {
                    return res.status(409).json({
                        success: false,
                        trialNotAllowed: true,
                        code: 'DEVICE_TRIAL_ALREADY_USED',
                        msg: 'This device has already been used for a free trial'
                    });
                }
                const userAgain = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [
                    userId
                ]);
                return res.status(200).json({
                    success: true,
                    alreadyClaimed: true,
                    user: userAgain?.[0] || null
                });
            }
            return res.status(500).json({
                success: false,
                code: 'CLAIM_INSERT_FAILED',
                msg: 'Could not record device trial claim'
            });
        }

        const updOk = await query('UPDATE `users` SET `memberships` = ? WHERE id = ? LIMIT 1', [
            membershipsJson,
            userId
        ]);

        if (!updOk) {
            return res.status(500).json({
                success: false,
                code: 'USER_UPDATE_FAILED',
                msg: 'Could not update user memberships'
            });
        }

        const updated = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [userId]);

        return res.status(200).json({
            success: true,
            msg: 'Free trial granted',
            deviceTrialProductId: DEVICE_TRIAL_PRODUCT_ID,
            user: updated[0]
        });
    } catch (error) {
        if (error && error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                success: false,
                code: 'MIGRATION_REQUIRED',
                msg: 'Run scripts/sql/device_trial_claims.sql'
            });
        }
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                trialNotAllowed: true,
                code: 'DEVICE_TRIAL_ALREADY_USED',
                msg: 'This device has already been used for a free trial'
            });
        }
        console.error('claim-free-trial error:', error);
        return res.status(500).json({
            success: false,
            msg: 'Server error'
        });
    }
});

router.post('/sync-memberships', middleware, async (req, res) => {
    try {
        const { userId, memberships } = req.body;

        if (!userId) {
            return res.status(400).json({
                msg: 'userId is required',
                success: false
            });
        }

        const gate = assertJwtMatchesUserId(req, userId);
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }

        if (!Array.isArray(memberships)) {
            return res.status(400).json({
                msg: 'memberships must be an array',
                success: false
            });
        }

        const normalizedMemberships = [];
        for (const membership of memberships) {
            const normalized = normalizeMembership(membership);
            if (normalized?.error) {
                return res.status(400).json({
                    msg: normalized.error,
                    success: false
                });
            }
            normalizedMemberships.push(normalized);
        }

        const existingUser = await getQuery('SELECT * FROM `users` WHERE id = ?', [userId]);
        if (!existingUser || existingUser.length === 0) {
            return res.status(404).json({
                msg: 'User not found',
                success: false
            });
        }

        const merged = mergeMembershipsDbWithClient(
            existingUser[0].memberships,
            normalizedMemberships
        );

        await query('UPDATE `users` SET `memberships` = ? WHERE id = ?', [
            JSON.stringify(merged),
            userId
        ]);

        const rcCustomerId = pickRevenueCatCustomerId(req.body);
        if (rcCustomerId) {
            await persistRevenueCatCustomerId(userId, rcCustomerId);
        }

        const updatedUser = await getQuery('SELECT * FROM `users` WHERE id = ?', [userId]);

        return res.status(200).json({
            msg: 'Memberships synced successfully',
            success: true,
            user: updatedUser[0]
        });
    } catch (error) {
        console.error('sync-memberships error:', error);
        return res.status(500).json({
            msg: 'Server error',
            success: false
        });
    }
});

module.exports = router;
