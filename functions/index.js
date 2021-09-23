const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

exports.maintainTimestamps = functions.firestore
.document('{colId}/{docId}')
.onWrite(async (change, context) => {

    // the collections you want to trigger
    const setCols = ['all_posts', 'timeline'];

    // if not one of the collections listed above, return
    if (setCols.indexOf(context.params.colId) === -1) {
        return null;
    }

    // simplify event types
    const createDoc = change.after.exists && !change.before.exists;
    const updateDoc = change.before.exists && change.after.exists;
    const deleteDoc = change.before.exists && !change.after.exists;

    if (deleteDoc) {
        return null;
    }
    // simplify input data
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    // prevent update loops from triggers
    const canUpdate = () => {
        // if update trigger
        if (before.updatedAt && after.updatedAt) {
            if (after.updatedAt._seconds !== before.updatedAt._seconds) {
                return false;
            }
        }
        // if create trigger
        if (!before.createdAt && after.createdAt) {
            return false;
        }
        return true;
    }

    // add createdAt
    if (createDoc) {
        return change.after.ref.set({
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
            .catch(e => {
                console.log(e);
                return false;
            });
    }
    // add updatedAt
    if (updateDoc && canUpdate()) {
        return change.after.ref.set({
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
            .catch(e => {
                console.log(e);
                return false;
            });
    }
    return null;
});

    exports.onCreateConnection = functions.firestore
        .document('/connections/{userId}/userConnections/{connectionId}')
        .onCreate(async (snapshot, context) => {
            console.log("Connection Created", snapshot.id);
            const userId = context.params.userId
            const connectionId = context.params.connectionId

            // Ensure connection is bi-directional
            admin.firestore().collection("connections").doc(connectionId).collection("userConnections").doc(userId).set({});

            admin.firestore().collection("connectRequests").doc(userId).collection("userSentRequests").doc(connectionId).delete();
            admin.firestore().collection("connectRequests").doc(connectionId).collection("userReceivedRequests").doc(userId).delete();

            const connectingUsersPostsRef = admin.firestore().collection("all_posts").where('ownerId', '==', userId);

            // Create connected user's timeline ref
            const timelinePostsRef = admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts");

            // Get users myPosts
            const querySnapshot = await connectingUsersPostsRef.get();

            // Add the connected users requests to connecting user's timelinePosts
            querySnapshot.forEach(doc => {
              if (doc.exists) {
                 const postId = doc.id
                 const postData = doc.data();
                 timelinePostsRef.doc(postId).set(postData);
              }
            });
        });

    exports.onDeleteConnection = functions.firestore
        .document('/connections/{userId}/userConnections/{connectionId}')
        .onDelete(async (snapshot, context) => {

            console.log("Connection Deleted", snapshot.id);
            const userId = context.params.userId;
            const connectionId = context.params.connectionId;

            // Ensure that both directions of the connection are deleted.
            admin.firestore().collection("connections").doc(connectionId).collection("userConnections").doc(userId).delete();

            const timelinePostsRefSelf = admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").where("ownerId", "==", userId);
            const timelinePostsRefConnection = admin.firestore().collection("timeline").doc(userId).collection("timelinePosts").where("ownerId", "==", connectionId);
            const querySnapshotSelf = await timelinePostsRefSelf.get();
            const querySnapshotConnection = await timelinePostsRefConnection.get();

            querySnapshotSelf.forEach(doc => {
              if (doc.exists) {
                doc.ref.delete();
              }
            });
            querySnapshotConnection.forEach(doc => {
              if (doc.exists) {
                doc.ref.delete();
              }
            });
        });

  exports.onCreatePost = functions.firestore
    .document('/all_posts/{postId}')
    .onCreate(async (snapshot, context) => {

        const postData = snapshot.data();
        const { ownerId } = postData;
        const postId = context.params.postId;

        const userConnectionsRef = admin.firestore().collection("connections").doc(ownerId).collection("userConnections");

        const connectionsQuerySnapshot = await userConnectionsRef.get();

        connectionsQuerySnapshot.forEach(doc => {
          const connectionId = doc.id;
          admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").doc(postId).set(postData);
        });
    });

    exports.onCreateReferral = functions.firestore
    .document('/referrals/{referralId}')
    .onCreate(async (snapshot, context) => {

      /*
       * [START] Add the sender into "bumpers" collection
       */
      const referral = snapshot.data()
      const { askId, senderId, receiverId } = referral;

      const senderUserRef = admin.firestore().collection("users").doc(senderId);
      const senderUserSnapshot = await senderUserRef.get();
      const sender = senderUserSnapshot.data();

      const receiverUserRef = admin.firestore().collection("users").doc(receiverId);
      const receiverUserSnapshot = await receiverUserRef.get();
      const receiver = receiverUserSnapshot.data();

      const senderBumpedPostsRef = await senderUserRef.collection("bumpedPosts").doc(askId).collection("users")

      const receiverIsInSenderBumpedGroup = await senderBumpedPostsRef.doc(receiverId).get();
      const senderIsInPostBumperGroup = await admin.firestore().collection("all_posts").doc(askId).collection("bumpers").doc(senderId).get();


      if (!senderIsInPostBumperGroup .exists) {
        // add receiver to post's bumper group
        admin.firestore().collection("all_posts").doc(askId).collection("bumpers").doc(senderId).set(sender);
      }

      if (!receiverIsInSenderBumpedGroup.exists) {
        // add receiver to user's post bump group
        senderBumpedPostsRef.doc(receiverId).set(receiver);
      } 
    });



    exports.onUpdateReferral = functions.firestore
    .document('/referrals/{referralId}')
    .onUpdate(async (snapshot, context) => {

        const referral = snapshot.after.data();
        const { askId, senderId, receiverId, status } = referral;

        /*
         * Add Receiver as Winger onAccept
         */
        if (status === "accepted") {

          const receiverUserRef = admin.firestore().collection("users").doc(receiverId);
          const receiverUserSnapshot = await receiverUserRef.get();
          const receiver = receiverUserSnapshot.data();

          const wingerUserRef =  admin.firestore().collection("all_posts").doc(askId).collection("wingers").doc(receiverId)
          const wingerUserSnapshot = await wingerUserRef.get();

          if (!wingerUserSnapshot.exists) {
            admin.firestore().collection("all_posts").doc(askId).collection("wingers").doc(receiverId).set(receiver);
          }
        }
    });

    exports.onUpdatePost = functions.firestore
      .document('/all_posts/{postId}')
      .onUpdate(async (snapshot, context) => {

        // Reject updates that occur within 1000 milliseconds of their previous update
        const after = snapshot.after.exists ? snapshot.after.data() : null;
        const before = snapshot.before.exists ? snapshot.before.data() : null;
        if (after.updatedAt.toMillis() - before.updatedAt.toMillis < 1000) {
          return;
        }

        const postData = snapshot.after.data();
        const { ownerId } = postData;
        const { postId } = context.params;

        const userConnectionsRef = admin.firestore().collection("connections").doc(ownerId).collection("userConnections");
        const connectionsQuerySnapshot = await userConnectionsRef.get();

        connectionsQuerySnapshot.forEach(doc => {
          // update the timeline of user's connections
          const connectionId = doc.id;
          admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").doc(postId).set(postData);
        });

        // update the timeline of user
        admin.firestore().collection("timeline").doc(ownerId).collection("timelinePosts").doc(postId).set(postData)
    });

    exports.onUpdateTimelinePost = functions.firestore
      .document('/timeline/{ownerId}/timelinePosts/{postId}')
      .onUpdate(async (snapshot, context) => {

        // Reject updates that occur within 1000 milliseconds of their previous update
        const after = snapshot.after.exists ? snapshot.after.data() : null;
        const before = snapshot.before.exists ? snapshot.before.data() : null;
        if (after.updatedAt.toMillis() - before.updatedAt.toMillis() < 1000) {
          return;
        }
        
        const postData = snapshot.after.data();
        const { postId, ownerId } = context.params;

        // update the profile of user (this will trigger the update for connection's timeline)
        admin.firestore().collection("all_posts").doc(postId).set(postData)
    });

    exports.onDeletePost = functions.firestore
        .document('/all_posts/{postId}')
        .onDelete(async (snapshot, context) => {

            const postData = snapshot.data();
            const { ownerId } = postData;
            const postId = context.params.postId;

            const userConnectionsRef = admin.firestore().collection("connections").doc(ownerId).collection("userConnections");
            const connectionsQuerySnapshot = await userConnectionsRef.get();

            const referralsReceivedForPost = admin.firestore().collection("referrals").where('askId', '==', postId);
            const referralsSnapshot = await referralsReceivedForPost.get();

            referralsSnapshot.forEach(doc => {
              const referralId = doc.id;
              admin.firestore().collection("referrals").doc(referralId).delete();
            });

            connectionsQuerySnapshot.forEach(doc => {
              const connectionId = doc.id;
              admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").doc(postId).delete();
            });
        });

        exports.onDeleteUser = functions.firestore
        .document('/users/{userId}')
        .onDelete(async (snapshot, context) => {
            const deletedUserId = context.params.userId;

            const connectionsForDeletedUserRef = admin.firestore().collection("connections").doc("deletedId").collection("userConnections");
            const connectionsForDeletedUser = await connectionsForDeletedUserRef.get();

            connectionsForDeletedUser.forEach(doc => {
              if (doc.exists) {
                doc.ref.delete();
              }
            });
        });

// Listens for bumps/referrals
exports.onActivityCreatePushNotifs = functions.firestore
  .document('/activity/{recipientId}/feedItems/{itemId}')
  .onCreate( async (snapshot, event) => {

    const data = snapshot.data();
    const { 
      type, 
      username, // sender
    } = data;
    const { recipientId } = event.params

    const devices = await admin.firestore().collection('devices').where('userId', '==', recipientId).get()

    const tokenSet = new Set(); // user's unique device token

    for (const device of devices.docs) {
      const token = device.data().pushNotificationToken;
      
      token && tokenSet.add(token);
    }

    const tokens = [...tokenSet]; 

    const formatNotificationString = (type, username) => {
      switch(type) {
        case "connectRequest":
          return `${username} wants to connect with you.`
        case "connectRequestAccepted":
          return `${username} accepted your connect request.`
        case "referred":
          return `${username} has referred you to help their friend.`
        case "comment":
          return `${username} has commented on your post`
        default: 
          return null;
      }
    }
    
    const body = formatNotificationString(type, username);

    if (body) {
      const payload = {
        notification: {
            body,
            sound: "default"
        }
      }

      try {
        const response = await admin.messaging().sendToDevice(tokens, payload);
        functions.logger.log("push-notifications-response:", response);
      } catch (err) {
        functions.logger.log("notification error", err);
      }
    } else {
      functions.logger.log("Activity is not of push notification type");
    }
});
