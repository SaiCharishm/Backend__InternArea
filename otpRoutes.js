const express = require("express");
const router = express.Router();
const OTP = require('./path/to/otpModel'); // Import the OTP model

// Route to check OTP
router.post("/check-otp", async (req, res) => {
  const { mobile, otp } = req.body;

  try {
    // Find the OTP record in the database
    const otpRecord = await OTP.findOne({ mobile: mobile, otp: otp, expiresAt: { $gt: new Date() } });

    if (otpRecord) {
      // OTP is valid
      res.status(200).json({ message: "OTP is valid" });
    } else {
      // OTP is either invalid or expired
      res.status(400).json({ error: "Invalid OTP" });
    }
  } catch (error) {
    console.error("Error checking OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
