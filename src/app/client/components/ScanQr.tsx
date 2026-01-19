// 'use client'
// import React, { useEffect, useState } from 'react'
// import SQRbutton from './buttons/SQRbutton';
// import Image from 'next/image';

// type ConnectionStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'failed';

// const ScanQr = () => {
//   const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
//   const [roomId, setRoomId] = useState<string | null>(null);
//   const [errorMsg, setErrorMsg] = useState<string | null>(null);

//   useEffect(() => {
//     const handlePairDevice = async (event: Event) => {
//       const customEvent = event as CustomEvent;
//       const scannedRoomId = customEvent.detail;
//       console.log('Pairing with room ID:', scannedRoomId);
      
//       setRoomId(scannedRoomId);
//       setConnectionStatus('connecting');
//       setErrorMsg(null);

//       try {
//         // Verify the room exists by fetching its data
//         const response = await fetch(`/api/signaling/${scannedRoomId}`);
        
//         if (!response.ok) {
//           throw new Error(`Room not found. Status: ${response.status}`);
//         }

//         const data = await response.json();
//         console.log('Room data fetched:', data);

//         // Wait a bit to ensure guardian receives the connection
//         await new Promise(resolve => setTimeout(resolve, 500));

//         // Successfully connected
//         setConnectionStatus('connected');
//         console.log('Connected successfully to room:', scannedRoomId);

//         // Redirect to patient scanner with room ID after a brief delay
//         setTimeout(() => {
//           window.location.href = `/client?pairWith=${encodeURIComponent(scannedRoomId)}`;
//         }, 1500);
//       } catch (err) {
//         const errorMessage = err instanceof Error ? err.message : 'Connection failed';
//         console.error('Connection failed:', err);
//         setConnectionStatus('failed');
//         setErrorMsg(errorMessage);
        
//         // Reset after 3 seconds
//         setTimeout(() => {
//           setConnectionStatus('idle');
//           setRoomId(null);
//           setErrorMsg(null);
//         }, 3000);
//       }
//     };

//     window.addEventListener('pairDevice', handlePairDevice);
//     return () => window.removeEventListener('pairDevice', handlePairDevice);
//   }, []);

//   const getStatusContent = () => {
//     switch (connectionStatus) {
//       case 'scanning':
//         return {
//           title: 'Scanning...',
//           icon: '📸',
//           color: 'text-blue-500',
//           description: 'Point camera at QR code'
//         };
//       case 'connecting':
//         return {
//           title: 'Connecting...',
//           icon: '🔗',
//           color: 'text-blue-500',
//           description: `Connecting to room: ${roomId?.substring(0, 8)}...`,
//           showLoader: true
//         };
//       case 'connected':
//         return {
//           title: 'Connected Successfully!',
//           icon: '✅',
//           color: 'text-green-500',
//           description: 'Redirecting to monitoring...'
//         };
//       case 'failed':
//         return {
//           title: 'Connection Failed',
//           icon: '❌',
//           color: 'text-red-500',
//           description: errorMsg || 'Unable to connect to room',
//           error: true
//         };
//       default:
//         return null;
//     }
//   };

//   const statusContent = getStatusContent();

//   if (statusContent) {
//     return (
//       <div className="flex flex-col items-center justify-center gap-4 text-center px-4 min-h-screen">
//         <div className={`text-6xl ${statusContent.color} transition-all`}>
//           {statusContent.showLoader ? (
//             <div className="animate-spin">🔄</div>
//           ) : (
//             statusContent.icon
//           )}
//         </div>
//         <h1 className={`text-3xl font-bold ${statusContent.color}`}>
//           {statusContent.title}
//         </h1>
//         <p className="text-lg text-gray-600">
//           {statusContent.description}
//         </p>
//         {statusContent.error && (
//           <button
//             onClick={() => {
//               setConnectionStatus('idle');
//               setRoomId(null);
//               setErrorMsg(null);
//             }}
//             className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
//           >
//             Try Again
//           </button>
//         )}
//       </div>
//     );
//   }

//   return (
    
//       <SQRbutton />
//     </div>
//   );
// }

// export default ScanQr
