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

            admin.firestore().collection("connectRequests").doc(userId).collection("userSentRequests").doc(connectionId).delete();
            admin.firestore().collection("connectRequests").doc(connectionId).collection("userReceivedRequests").doc(userId).delete();

            console.log("Connection Created", snapshot.id);
            const userId = context.params.userId
            const connectionId = context.params.connectionId

            const connectingUsersPostsRef = admin.firestore().collection("all_posts").where('ownerId', '==', userId).get()

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

            connectionsQuerySnapshot.forEach(doc => {
              const connectionId = doc.id;
              admin.firestore().collection("timeline").doc(connectionId).collection("timelinePosts").doc(postId).delete();
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

        // exports.onUpdate = functions.firestore
        //     .document('/myPosts/{userId}/userPosts/{postId}')
        //     .onUpdate(async (snapshot, context) => {
        //
        //         const postData = snapshot.data();
        //         const userId = context.params.userId;
        //         const postId = context.params.postId;
        //
        //         const userFollowersRef = admin.firestore().collection("followers").doc(userId).collection("userFollowers");
        //
        //         const querySnapshot = await userFollowersRef.get();
        //
        //         querySnapshot.forEach(doc => {
        //           const followerId = doc.id;
        //
        //           admin.firestore().collection("timeline").doc(followerId).collection("timelinePosts").doc(postId).update(postData);
        //
        //
        //         });
        //
        //     });




    // exports.onCreateComment = functions.firestore
    // .document('/comments/{postId}/postComments/{ownderId}')
    // .onCreate((snapshot, context) => {
    //
    //   const postId = context.params.postId;
    //   const ownerId = context.params.ownerId;
    //   console.log(postId + 'was commented by user -' + ownerId)
    //
    //     admin.firestore().collection('/myPosts' + postId).once('value').then(function (snap) {
    //         console.log("Test")
    //
    //         if (snap.collection("userPosts").doc(postId).collection("ownerId").val() !== null) {
    //             const posterId = snap.collection("userPosts").doc(postId).collection("ownerId").val()
    //             console.log("Test", posterId)
    //
    //             admin.firestore().collection('users/' + posterId).once('value').then(function (snap2) {
    //
    //                 const posterName = snap2.collection("username").val()
    //                 const deviceId = snap2.collection("deviceId").val()
    //
    //                 console.log(posterId, posterName)
    //                 console.log("Test", deviceId)
    //                 const payload = {
    //                     notification: {
    //                         title: "New Recommendation!",
    //                         body: "You have a new recommendation from" + ' ' + posterName,
    //                         icon: 'default',
    //                     }
    //                 };
    //                 const date = new Date();
    //                 const notifId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    //                 admin.database().ref('users/' + posterId + '/notifications/' + notifId).set({
    //                     title : "New Favorite",
    //                     recommender : userId,
    //                     post : postId,
    //                     date : date.toISOString()
    //                 });
    //                 admin.messaging().sendToDevice(deviceId, payload)
    //                 .then(function (response) {
    //                     console.log("Successfully sent message:", response);
    //                     return
    //                 })
    //                 .catch(function (error) {
    //                     console.log("Error sending message:", error);
    //                     return
    //                 });
    //                 return
    //
    //             }).catch(function (error) {
    //                 console.log("Error sending message:", error);
    //                 return
    //             });
    //         } else {
    //             console.log("error", snap)
    //             return
    //         }
    //         return
    //     }).catch(function (error) {
    //         console.log("Error sending message:", error);
    //         return
    //     });
    // });




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

    const tokens = []; // user's device token

    for (const device of devices.docs) {
      const token = device.data().pushNotificationToken;
      token && tokens.push(token);
    }

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