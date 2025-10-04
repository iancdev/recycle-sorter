# Project Information
This document serves as the PRD for this project, providing information regardings its planned infrastructure and inner workings. 

# Description
The idea of this project is simple. It sorts recycling and garbage and provides refunds to the user directly to their account, that's linked to their student ID. The user scans their ID card, then begins depositing. This sorting processes uses an external webcam that connects to a computer, which uses computer vision to analyze the garbage/recycling, which then uses a microcontroller (ESP32) that connects to a robotic Lazy Susan, that then directs the user to deposit the trash into. The category is stored per session, allowing the session to be linked to the user ID. Then, the user would have their money directly available in their account.

# Physical Build
- ESP32 Microcontroller: This microcontroller controls the robotic lazy susan, and connects with the computer to receive instructions.
- Lazy Susan: This is the lazy susan.
- Edge Computer: This computer uses its connected webcam to then perform computer vision tasks, which will categorize the trash, then subsequently send commands to the ESP32 microcontroller.

# Tech Stack
We will use various tech to create this.
- Frontend: NextJS
- Backend/auth/database: Supabase, Netlify
- Edge computer: OpenCV + Python

# Flow
1. User scans their student ID (which has a barcode, we scan continously for a barcode). Upon valid read, their account shows up
2. The user's account details show up. If no account, one is created. 
3. The user is directed to deposit their recycling
4. The item is identified and the correct recycling bin is rotated towards the user
5. The user deposits the trash
6. The bottle deposit is refunded to the user via their account (deposit, add funds)

# Categories to identify
- Cans
- Juice Boxes
- Garbage

## Edge computer
The edge computer's task is to perform computer vision tasks using Python, and send commands to the ESP32 microcontroller. The edge computer must retrieve the current active session ID, perform categorization, then send the categorized item with the current active session ID. We will do this via Supabase Realtime. The computer vision will be using OpenCV with Yolov5 with a trained model to identify the above categories. During the earlier stages of the project, we plan to build image recognition using LLMs as fallback.

## Frontend (Self-service kiosk on iPad)
The frontend is made with NextJS. The camera is always active, scanning for barcodes. Upon valid scan of a valid barcode, their account is access and a new session id is generated and linked with this user ID. The active session ID is set to this new session ID. The user is then told their balance, recent transactoins, and the user may then begin to deposit their items into the bins after categorization. THe display shows what category each identified item is going into, and what it recognized. THis allows for user interaction and feedback. As well, the user is shown how much they are earning for each of the item deposited. This will be a huge prompt that shows up, in a beautiful manner, with the item category, a logo representing it, and the amount they just received for this. We will use Supabase Realtime for live current active session and account information retrieval. This allows simultaneous interaction.

### Other Options
After the user finishes scanning, the user can view a receipt style collection of all their items thus far that they have added on the left. Their session total is shown under this receipt. As well, it shows their balance on the right side. Additionally, it allows users to interact and show their previous session earnings, which shows past 5 sessoins. The user can press View All which shows all of them in a list. The user is also given 2 options: to link their phone number and email. This allows them to access their balance later.


## Backend
The backend and authentication is simple. Each new user can link their barcode (student ID), which creates or logs them in when they access this. The frontend closely interacts with the backend. Upon addition of a transaction into the ledger, the user's balance is updated. This allows for a cached balance, so the user always has access to their balance without querying the ledger everytime. Each transaction automatically updates their balance. Since each session is stored as well, we also create and track per session earnings, so that the frontend can show this information.

## Frontend - Dashboard
This frontend acts differently than the self service variant. This allows the user to view their balance, transactoins, and past sessions later when no longer at the location.

This dashboard allows 3 sign in optoins:
- Email
- Phone
- Student ID (barcode scan)
For barcode scan, the user turns on their camera, and once the scan is complete, the barcode is automatically captured and logs the user in (by generating valid Supabase session ID).

The dashboard shows the user their balance, their latest sessions (last 5) with their earnings respectively, and shows statistics such as what category they used the most (what was the most returned items).

To ensure security, we will use proper RLS and APIs will be protected properly by requiring valid supabase sessions.