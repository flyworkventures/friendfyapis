const router = require('express').Router();
const middleware = require('../middleware/checkAuth');
const { getQuery, query } = require('../db');

const ALLOWED_MEMBERSHIP_TYPES = new Set(['paid', 'trial', 'freeTrial']);

function normalizeIsoDate(value, { nullable = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    return { error: 'invalid_date' };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: 'invalid_date' };
  }

  return date.toISOString();
}

function normalizeMembership(membership) {
  if (!membership || typeof membership !== 'object' || Array.isArray(membership)) {
    return { error: 'invalid_membership' };
  }

  const normalizedStartDate = normalizeIsoDate(membership.startDate);
  if (normalizedStartDate?.error) {
    return { error: 'startDate must be a valid ISO date' };
  }

  const normalizedEndDate = normalizeIsoDate(membership.endDate, { nullable: true });
  if (normalizedEndDate?.error) {
    return { error: 'endDate must be a valid ISO date or null' };
  }

  const normalizedPurchasedAt = normalizeIsoDate(membership.purchasedAt, { nullable: true });
  if (normalizedPurchasedAt?.error) {
    return { error: 'purchasedAt must be a valid ISO date or null' };
  }

  if (!membership.productId || typeof membership.productId !== 'string') {
    return { error: 'productId is required and must be a string' };
  }

  if (!ALLOWED_MEMBERSHIP_TYPES.has(membership.type)) {
    return { error: 'type must be one of: paid, trial, freeTrial' };
  }

  if (typeof membership.isActive !== 'boolean') {
    return { error: 'isActive must be a boolean' };
  }

  return {
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    productId: membership.productId,
    type: membership.type,
    isActive: membership.isActive,
    purchasedAt: normalizedPurchasedAt
  };
}

router.post('/sync-memberships', middleware, async (req, res) => {
  try {
    const { userId, memberships } = req.body;

    if (!userId) {
      return res.status(400).json({
        msg: 'userId is required',
        success: false
      });
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

    await query('UPDATE `users` SET `memberships` = ? WHERE id = ?', [
      JSON.stringify(normalizedMemberships),
      userId
    ]);

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
