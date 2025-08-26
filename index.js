const functions = require("firebase-functions");
const admin = require("firebase-admin");
// ... other requires like crypto, cors etc.

admin.initializeApp();
const db = admin.firestore();

// ========================================================
// YOUR EXISTING FUNCTIONS (IF ANY)
// ========================================================

/**
 * FOR ADMIN USE: Grants a user access to a material after manual payment verification.
 */
exports.grantAccessManually = functions.https.onCall(async (data, context) => {
    // ... your grant access code is here ...
});


// ========================================================
// PASTE THE NEW FUNCTION HERE
// ========================================================

/**
 * FOR ADMIN USE: Revokes a user's access to a specific material.
 * This function should only be callable by an admin.
 */
exports.revokeAccessManually = functions.https.onCall(async (data, context) => {
    // Security Check: Ensure the caller is an admin
    // Note: Make sure you've set up custom claims for the admin role.
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError(
            'permission-denied', 
            'You must be an admin to perform this action.'
        );
    }

    const { userId, materialId } = data;
    if (!userId || !materialId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required data: userId and materialId.');
    }

    try {
        const purchasedMaterialRef = db.collection('users').doc(userId)
            .collection('purchasedMaterials').doc(materialId);

        // Delete the purchase record to revoke access
        await purchasedMaterialRef.delete();

        // Optional but recommended: Update the original order status for record-keeping
        const orderQuery = await db.collection('orders')
            .where('userId', '==', userId)
            .where('materialId', '==', materialId)
            .where('status', '==', 'success')
            .limit(1).get();
        
        if (!orderQuery.empty) {
            const orderDoc = orderQuery.docs[0];
            await orderDoc.ref.update({ status: 'revoked' });
        }

        return { status: "success", message: `Access revoked for material ${materialId} from user ${userId}` };

    } catch (error) {
        console.error("Error revoking access manually:", error);
        throw new functions.https.HttpsError('internal', `Failed to revoke access. Error: ${error.message}`);
    }
});
