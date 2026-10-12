# Seating Control Center — Platforms free-tier update

## Install
1. Back up your existing `src/platforms.js`.
2. Copy this `platforms.js` file into your project's `src/` folder and replace `src/platforms.js`.
3. Save the file.
4. From the project root, run `npm run build`.

## Important security note
This file removes the Cloud Functions callable imports and uses direct Firestore writes for platform creation/status updates. Your currently described Firestore rules deny all client writes, so those actions will fail until a carefully reviewed rules design is applied. Do not loosen rules broadly or allow users to edit their own role/status. Client-side audit records are not tamper-proof. This ZIP does not include updated Firestore rules or a production-ready trusted backend.

This update is intended for continued local testing only until the rules are reviewed. No paid Firebase plan is required to download or inspect these files. Hosting and Firebase services remain subject to their current free-tier limits.
