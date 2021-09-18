const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

exports.onCreateFollower = functions.firestore
    .document('/followers/{userId}/userFollowers/{followerId}')
    .onCreate(async (snapshot, context) => {

        console.log("Follower Created", snapshot.id);
        const userId = context.params.userId
        const followerId = context.params.followerId

        // Create followed users posts reference
        const followedUserPostRef = admin.firestore().collection("myPosts").doc(userId).collection("userPosts");
        const followedUserGemPostRef = admin.firestore().collection("gemPosts").doc(userId).collection("gemPosts");

        // Create following user's timeline ref
        const timelinePostsRef = admin.firestore().collection("timeline").doc(followerId).collection("timelinePosts");
        const timelineGemPostsRef = admin.firestore().collection("timeline").doc(followerId).collection("timelineGemPosts")

        // Get followed users myPosts
        const querySnapshot = await followedUserPostRef.get();
        const queryGemSnapshot = await followedUserGemPostRef.get();

        // Add each user post to following user's timelinePosts
        querySnapshot.forEach(doc => {
          if (doc.exists) {
             const postId = doc.id
             const postData = doc.data();
             timelinePostsRef.doc(postId).set(postData);
          }
        });
        queryGemSnapshot.forEach(doc => {
          if (doc.exists) {
             const postId = doc.id
             const postData = doc.data();
             timelineGemPostsRef.doc(postId).set(postData);
          }
        });

    });

    exports.onCreateConnection = functions.firestore
        .document('/connections/{userId}/userConnections/{connectionId}')
        .onCreate(async (snapshot, context) => {
            console.log("Connection Created", snapshot.id);
            const userId = context.params.userId
            const connectionId = context.params.connectionId

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

exports.onDeleteFollower = functions.firestore
    .document('/followers/{userId}/userFollowers/{followerId}')
    .onDelete(async (snapshot, context) => {

        console.log("Follower Deleted", snapshot.id);
        const userId = context.params.userId
        const followerId = context.params.followerId


        const timelinePostsRef = admin.firestore().collection("timeline").doc(followerId).collection("timelinePosts").where("ownerId", "==", userId);
        const timelineGemPostsRef = admin.firestore().collection("timeline").doc(followerId).collection("timelineGemPosts").where("ownerId", "==", userId);

        const querySnapshot = await timelinePostsRef.get();
        const queryGemSnapshot = await timelineGemPostsRef.get();

        querySnapshot.forEach(doc => {
          if (doc.exists) {
            doc.ref.delete()
          }
        });
        queryGemSnapshot.forEach(doc => {
          if (doc.exists) {
            doc.ref.delete()
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
      const { askId, senderId } = referral;

      // Short-circuit exit if user === sender; OP cannot be winger
      if (askId === senderId) { return }

      const userRef = admin.firestore().collection("users").doc(senderId);
      const userSnapshot = await userRef.get();
      const user = userSnapshot.data();

      const bumperUserRef = admin.firestore().collection("all_posts").doc(askId).collection("bumpers").doc(senderId)
      const bumperUserSnapshot = await bumperUserRef.get();

      if (!bumperUserSnapshot.exists) {
        admin.firestore()
        .collection("all_posts").doc(askId).collection("bumpers").doc(senderId).set(user);
      }
      /*
       * [END] Add the sender as a "winger"
       */
    })

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

    exports.onCreateGemPost = functions.firestore
        .document('/gemPosts/{userId}/gemPosts/{postId}')
        .onCreate(async (snapshot, context) => {

            const postData = snapshot.data();
            const userId = context.params.userId;
            const postId = context.params.postId;

            const userFollowersRef = admin.firestore().collection("followers").doc(userId).collection("userFollowers");

            const querySnapshot = await userFollowersRef.get();

            querySnapshot.forEach(doc => {
              const followerId = doc.id;

              admin.firestore().collection("timeline").doc(followerId).collection("timelineGemPosts").doc(postId).set(postData);


            });

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

        exports.onDeleteGemPost = functions.firestore
            .document('/gemPosts/{userId}/gemPosts/{postId}')
            .onDelete(async (snapshot, context) => {

                const postData = snapshot.data();
                const userId = context.params.userId;
                const postId = context.params.postId;

                const userFollowersRef = admin.firestore().collection("followers").doc(userId).collection("userFollowers");

                const querySnapshot = await userFollowersRef.get();

                querySnapshot.forEach(doc => {
                  const followerId = doc.id;

                  admin.firestore().collection("timeline").doc(followerId).collection("timelineGemPosts").doc(postId).set(postData);

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
