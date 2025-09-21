const { createClient } = require('@supabase/supabase-js');
const { BlobServiceClient } = require('@azure/storage-blob');
const jwt = require('jsonwebtoken');

module.exports = async function (context, req) {
    try {
        // Verify JWT token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return { status: 401, body: "Unauthorized" };
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Initialize Supabase client
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        // Get user info
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', decoded.userId)
            .single();
            
        if (userError || !user) {
            return { status: 404, body: "User not found" };
        }
        
        // Check if user is faculty or admin
        if (user.role !== 'faculty' && user.role !== 'admin') {
            return { status: 403, body: "Forbidden" };
        }
        
        // Get course ID and file info
        const courseId = req.query.courseId;
        const { title, description } = req.body;
        
        // Handle file upload
        const bodyBuffer = Buffer.from(req.body);
        const boundary = multipart.getBoundary(req.headers['content-type']);
        const parts = multipart.Parse(bodyBuffer, boundary);
        
        const file = parts.find(part => part.name === 'file');
        if (!file) {
            return { status: 400, body: "No file uploaded" };
        }
        
        // Upload to Azure Blob Storage
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.BLOB_STORAGE_CONNECTION_STRING);
        const containerName = 'course-materials';
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        await containerClient.createIfNotExists();
        
        const blobName = `${courseId}/${Date.now()}-${file.filename}`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        
        await blockBlobClient.uploadData(file.data, {
            blobHTTPHeaders: { blobContentType: file.type }
        });
        
        // Save to Supabase
        const { data: material, error: materialError } = await supabase
            .from('materials')
            .insert([{
                course_id: courseId,
                title: title,
                description: description,
                file_url: blobName,
                file_type: file.type,
                file_size: file.data.length,
                created_by: user.id
            }])
            .select()
            .single();
            
        if (materialError) {
            throw materialError;
        }
        
        return { status: 201, body: material };
    } catch (error) {
        context.log.error(error);
        return { status: 500, body: "Server error" };
    }
};
