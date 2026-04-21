const router = require('express').Router();
const JWT = require('jsonwebtoken');
const { getQuery, query } = require('../db');
const middleware = require('../middleware/checkAuth');

const ACCESS_TOKEN_EXPIRY = '365d'; // access token süresi (config yenilemede kullanılıyor)

// Config bilgilerini getir. Token süresi dolmuşsa refreshToken ile yenileyip yeni token da döner.
router.post('/config', async (req, res) => {
    try {
        const accessToken = req.header('x-auth-token');
        const refreshToken = req.header('x-refresh-token') || req.body?.refreshToken;
        let newToken = null;

        // Token varsa kontrol et; süresi dolmuşsa refresh token ile yenile
        if (accessToken) {
            try {
                JWT.verify(accessToken, 'key');
                // Token geçerli, ek işlem yok
            } catch (err) {
                if (err.name === 'TokenExpiredError' && refreshToken) {
                    try {
                        const payload = JWT.verify(refreshToken, 'key');
                        if (payload.type === 'refresh' && payload.email) {
                            newToken = JWT.sign(
                                { email: payload.email },
                                'key',
                                { expiresIn: ACCESS_TOKEN_EXPIRY }
                            );
                        }
                    } catch (refreshErr) {
                        // Refresh token geçersiz veya süresi dolmuş, config yine döner, token yenilenmez
                    }
                }
            }
        }

        // Tabloda id kolonu yok, ilk satırı alıyoruz
        const results = await getQuery("SELECT * FROM `config` LIMIT 1", []);
        if (results.length === 0) {
            return res.status(404).json({
                msg: "Config not found",
                success: false
            });
        }

        const response = {
            msg: "Config retrieved successfully",
            success: true,
            config: results[0]
        };
        if (newToken) {
            response.token = newToken;
            response.code = "TOKEN_RENEWED";
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error("get-config error:", error);
        return res.status(500).json({
            msg: "Server error",
            success: false,
            error: error.message
        });
    }
});

// Config değerlerini güncelle (app_version dahil)
router.post('/update-config', middleware, async (req, res) => {
    try {
        const {
            app_version,
            app_name,
            maintenance_mode,
            max_agents_per_user,
            max_conversations_per_user,
            jwt_expires_in,
            refresh_token_expires_in,
            max_message_length,
            enable_registration,
            enable_google_auth,
            enable_apple_auth,
            api_rate_limit,
            support_email,
            support_url,
            privacy_policy_url,
            terms_of_service_url,
            feature_flags
        } = req.body;

        // Config kaydının var olup olmadığını kontrol et
        const configCheck = await getQuery("SELECT * FROM `config` LIMIT 1", []);
        
        if (configCheck.length === 0) {
            return res.status(404).json({
                msg: "Config not found",
                success: false
            });
        }

        // Güncelleme işlemi
        let updateQuery = "UPDATE `config` SET ";
        let updateValues = [];
        let updateFields = [];

        if (app_version !== undefined && app_version !== null) {
            updateFields.push("app_version = ?");
            updateValues.push(app_version);
        }

        if (app_name !== undefined && app_name !== null) {
            updateFields.push("app_name = ?");
            updateValues.push(app_name);
        }

        if (maintenance_mode !== undefined && maintenance_mode !== null) {
            updateFields.push("maintenance_mode = ?");
            updateValues.push(maintenance_mode);
        }

        if (max_agents_per_user !== undefined && max_agents_per_user !== null) {
            updateFields.push("max_agents_per_user = ?");
            updateValues.push(max_agents_per_user);
        }

        if (max_conversations_per_user !== undefined && max_conversations_per_user !== null) {
            updateFields.push("max_conversations_per_user = ?");
            updateValues.push(max_conversations_per_user);
        }

        if (jwt_expires_in !== undefined && jwt_expires_in !== null) {
            updateFields.push("jwt_expires_in = ?");
            updateValues.push(jwt_expires_in);
        }

        if (refresh_token_expires_in !== undefined && refresh_token_expires_in !== null) {
            updateFields.push("refresh_token_expires_in = ?");
            updateValues.push(refresh_token_expires_in);
        }

        if (max_message_length !== undefined && max_message_length !== null) {
            updateFields.push("max_message_length = ?");
            updateValues.push(max_message_length);
        }

        if (enable_registration !== undefined && enable_registration !== null) {
            updateFields.push("enable_registration = ?");
            updateValues.push(enable_registration);
        }

        if (enable_google_auth !== undefined && enable_google_auth !== null) {
            updateFields.push("enable_google_auth = ?");
            updateValues.push(enable_google_auth);
        }

        if (enable_apple_auth !== undefined && enable_apple_auth !== null) {
            updateFields.push("enable_apple_auth = ?");
            updateValues.push(enable_apple_auth);
        }

        if (api_rate_limit !== undefined && api_rate_limit !== null) {
            updateFields.push("api_rate_limit = ?");
            updateValues.push(api_rate_limit);
        }

        if (support_email !== undefined && support_email !== null) {
            updateFields.push("support_email = ?");
            updateValues.push(support_email);
        }

        if (support_url !== undefined && support_url !== null) {
            updateFields.push("support_url = ?");
            updateValues.push(support_url);
        }

        if (privacy_policy_url !== undefined && privacy_policy_url !== null) {
            updateFields.push("privacy_policy_url = ?");
            updateValues.push(privacy_policy_url);
        }

        if (terms_of_service_url !== undefined && terms_of_service_url !== null) {
            updateFields.push("terms_of_service_url = ?");
            updateValues.push(terms_of_service_url);
        }

        if (feature_flags !== undefined && feature_flags !== null) {
            // JSON string'e çevir
            const featureFlagsJson = typeof feature_flags === 'string' 
                ? feature_flags 
                : JSON.stringify(feature_flags);
            updateFields.push("feature_flags = ?");
            updateValues.push(featureFlagsJson);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                msg: "No fields to update",
                success: false
            });
        }

        updateQuery += updateFields.join(", ");
        updateQuery += " LIMIT 1";

        const updateResult = await query(updateQuery, updateValues);

        if (!updateResult) {
            return res.status(500).json({
                msg: "Failed to update config",
                success: false
            });
        }

        // Güncellenmiş config bilgilerini al
        const updatedConfig = await getQuery("SELECT * FROM `config` LIMIT 1", []);

        return res.status(200).json({
            msg: "Config updated successfully",
            success: true,
            config: updatedConfig[0]
        });

    } catch (error) {
        console.error("update-config error:", error);
        return res.status(500).json({
            msg: "Server error",
            success: false,
            error: error.message
        });
    }
});

module.exports = router