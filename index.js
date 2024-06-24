require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const otpGenerator = require('otp-generator');
const twilio = require('twilio');
const AWS = require('aws-sdk');
const sgMail = require('@sendgrid/mail');

const app = express();
const port = process.env.PORT || 7480;

// Configure Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(cors({
    origin: 'http://localhost:3000', // Replace with your frontend URL
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization'
}));

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json());

// Access Control Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

// Error Handling Middleware for JSON Parsing Errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('Bad JSON');
        return res.status(400).send({ error: 'Bad JSON' });
    }
    next();
});

// MongoDB Atlas Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, // Increase timeout to 30 seconds
    socketTimeoutMS: 45000, // Increase socket timeout to 45 seconds
})
    .then(() => {
        console.log('MongoDB connection established successfully');
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
    });

// Configure AWS Translate
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

const translate = new AWS.Translate();

// Define schemas and models
const applicationSchema = new mongoose.Schema({
    coverLetter: String,
    user: Object,
    company: String,
    category: String,
    body: String,
    ApplicationId: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending'
    }
});

const Application = mongoose.model('Application', applicationSchema);

const internshipSchema = new mongoose.Schema({
    title: String,
    company: String,
    location: String,
    Duration: String,
    category: String,
    aboutCompany: String,
    aboutInternship: String,
    Whocanapply: String,
    perks: Array,
    AdditionalInfo: String,
    stipend: String,
    StartDate: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Internship = mongoose.model('Internship', internshipSchema);

const jobSchema = new mongoose.Schema({
    title: String,
    company: String,
    location: String,
    Experience: String,
    category: String,
    aboutCompany: String,
    aboutJob: String,
    Whocanapply: String,
    perks: Array,
    AdditionalInfo: String,
    CTC: String,
    StartDate: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Job = mongoose.model('Job', jobSchema);

const otpSchema = new mongoose.Schema({
    mobile: String,
    otp: String,
    expiresAt: Date
});

const OTP = mongoose.model('OTP', otpSchema);

const translateContent = async (text, targetLanguage) => {
    const params = {
        Text: text,
        SourceLanguageCode: 'auto', // or specify the source language
        TargetLanguageCode: targetLanguage,
    };
    try {
        const data = await translate.translateText(params).promise();
        return data.TranslatedText;
    } catch (error) {
        console.error('Translation error:', error);
        throw error;
    }
};

// Admin Login Route
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

// Login history
const loginHistorySchema = new mongoose.Schema({
    username: String,
    browserType: String,
    osType: String,
    ipAddress: String,
    loginTime: {
        type: Date,
        default: Date.now
    }
});

const LoginHistory = mongoose.model('LoginHistory', loginHistorySchema);

function getBrowserType(userAgent) {
    if (userAgent.includes('Chrome')) {
        return 'Google Chrome';
    } else if (userAgent.includes('Edge')) {
        return 'Microsoft Edge';
    } else {
        return 'Other';
    }
}

function getOSType(userAgent) {
    if (userAgent.includes('Windows')) {
        return 'Windows';
    } else if (userAgent.includes('Macintosh')) {
        return 'Mac';
    } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
        return 'iOS';
    } else if (userAgent.includes('Android')) {
        return 'Android';
    } else {
        return 'Other';
    }
}

// Middleware for Time-based Access Control for Mobile Devices
app.use((req, res, next) => {
    const userAgent = req.headers['user-agent'];
    const osType = getOSType(userAgent);

    // Check if it's a mobile device and restrict access outside 10 AM to 1 PM
    if (osType === 'iOS' || osType === 'Android') {
        const currentHour = new Date().getHours();
        if (currentHour < 10 || currentHour > 13) {
            return res.status(403).send('Access denied outside 10 AM to 1 PM');
        }
    }

    next();
});

app.use((req, res, next) => {
    const userAgent = req.headers['user-agent'];
    const browserType = getBrowserType(userAgent);
    const osType = getOSType(userAgent);
    const ipAddress = req.ip;

    // Store login information in MongoDB
    const loginInfo = new LoginHistory({
        username: req.body.username, // Adjust this based on your frontend form data
        browserType,
        osType,
        ipAddress,
        loginTime: new Date()
    });

    loginInfo.save()
        .then(() => {
            console.log('Login information recorded:', loginInfo);
        })
        .catch(err => {
            console.error('Error recording login information:', err);
        });

    next();
});

app.post('/api/admin/adminLogin', (req, res) => {
    const { username, password } = req.body;
    if (username === adminUsername && password === adminPassword) {
        res.send('Admin is here');
    } else {
        res.status(401).send('Unauthorized');
    }
});

// Routes for Applications
app.post('/api/application', async (req, res) => {
    const applicationData = new Application(req.body);
    try {
        const savedApplication = await applicationData.save();
        res.send(savedApplication);
    } catch (error) {
        console.log('Error saving application data:', error);
        res.status(500).send('Error saving application data');
    }
});

app.get('/api/application', async (req, res) => {
    try {
        const data = await Application.find();
        res.status(200).json(data);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/application/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const data = await Application.findById(id);
        if (!data) {
            res.status(404).json({ error: 'Application not found' });
        } else {
            res.status(200).json(data);
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/application/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const updatedApplication = await Application.findByIdAndUpdate(id, { status }, { new: true });
        if (!updatedApplication) {
            return res.status(404).json({ error: 'Application not found' });
        }
        res.status(200).json(updatedApplication);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Routes for Internships
app.post('/api/internship', async (req, res) => {
    const internshipData = new Internship(req.body);
    try {
        const savedInternship = await internshipData.save();
        res.send(savedInternship);
    } catch (error) {
        console.log('Error saving internship data:', error);
        res.status(500).send('Error saving internship data');
    }
});

app.get('/api/internship', async (req, res) => {
    try {
        const data = await Internship.find();
        res.status(200).json(data);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/internship/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const data = await Internship.findById(id);
        if (!data) {
            res.status(404).json({ error: 'Internship not found' });
        } else {
            res.status(200).json(data);
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Routes for Jobs
app.post('/api/jobs', async (req, res) => {
    const jobData = new Job(req.body);
    try {
        const savedJob = await jobData.save();
        res.send(savedJob);
    } catch (error) {
        console.log('Error saving job data:', error);
        res.status(500).send('Error saving job data');
    }
});

app.get('/api/jobs', async (req, res) => {
    try {
        const data = await Job.find();
        res.status(200).json(data);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/jobs/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const data = await Job.findById(id);
        if (!data) {
            res.status(404).json({ error: 'Job not found' });
        } else {
            res.status(200).json(data);
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// OTP Route
app.post('/api/send-otp', async (req, res) => {
    const { mobile, email } = req.body;

    try {
        // Generate a random OTP
        const otp = otpGenerator.generate(6, { digits: true, alphabets: false, upperCase: false, specialChars: false });

        // Send OTP via SMS
        if (mobile) {
            try {
                await twilioClient.messages.create({
                    body: `Your OTP is ${otp}`,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: mobile
                });
                console.log(`OTP ${otp} sent to mobile number: ${mobile}`);
            } catch (error) {
                console.error('Error sending OTP via SMS:', error);
                return res.status(500).json({ error: 'Error sending OTP via SMS' });
            }
        }

        // Send OTP via Email
        if (email) {
            try {
                const msg = {
                    to: email,
                    from: process.env.EMAIL_USER,
                    subject: 'Your OTP Code',
                    text: `Your OTP code is ${otp}`
                };
                await sgMail.send(msg);
                console.log(`OTP ${otp} sent to email: ${email}`);
            } catch (error) {
                console.error('Error sending OTP via Email:', error);
                return res.status(500).json({ error: 'Error sending OTP via Email' });
            }
        }

        // Store OTP in the database temporarily
        const newOTP = new OTP({
            mobile: mobile,
            email: email,
            otp: otp,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000) // OTP expires in 5 minutes
        });
        await newOTP.save();

        res.status(200).json({ message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// OTP Verification Route
app.post('/api/verify-otp', async (req, res) => {
    const { contact, otp } = req.body;
    const query = contact.includes('@') ? { email: contact, otp: otp } : { mobile: contact, otp: otp };

    try {
        const otpEntry = await OTP.findOne(query);
        if (!otpEntry) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        // Check if OTP is expired
        if (otpEntry.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: 'OTP expired' });
        }

        res.status(200).json({ success: true, message: 'OTP verified' });
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Example POST endpoint for language switching
app.post('/api/translate', async (req, res) => {
    const { text, targetLanguage } = req.body;
    try {
        const translatedText = await translateContent(text, targetLanguage);
        res.status(200).json({ translatedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/translated-content', async (req, res) => {
    const { lang } = req.query;
    const originalContent = 'Your original content here';
    try {
        const translatedText = await translateContent(originalContent, lang);
        res.send(translatedText);
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).send('Translation error');
    }
});

// Route to retrieve login history
app.get('/api/login-history', async (req, res) => {
    try {
        const loginHistory = await LoginHistory.find().sort({ loginTime: -1 }); // Sort by loginTime descending
        res.status(200).json(loginHistory);
    } catch (error) {
        console.error('Error retrieving login history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Test SendGrid email route
app.post('/api/test-email', async (req, res) => {
  const { email } = req.body;

  const msg = {
      to: email,
      from: process.env.EMAIL_USER, // your verified sender email
      subject: 'SendGrid Test Email',
      text: 'This is a test email from SendGrid.',
  };

  try {
      await sgMail.send(msg);
      res.status(200).json({ message: 'Test email sent successfully' });
  } catch (error) {
      console.error('Error sending test email:', error);
      res.status(500).json({ error: 'Error sending test email' });
  }
});


// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
