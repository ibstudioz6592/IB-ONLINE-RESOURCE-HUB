const { createClient } = require('@supabase/supabase-js');
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
        
        // Check if user is a student
        if (user.role !== 'student') {
            return { status: 403, body: "Only students can enroll in courses" };
        }
        
        const courseId = req.query.courseId;
        
        // Check if already enrolled
        const { data: existingEnrollment, error: checkError } = await supabase
            .from('enrollments')
            .select('*')
            .eq('user_id', user.id)
            .eq('course_id', courseId)
            .single();
            
        if (existingEnrollment) {
            return { status: 200, body: { message: "Already enrolled" } };
        }
        
        // Enroll the user
        const { data: enrollment, error: enrollmentError } = await supabase
            .from('enrollments')
            .insert([{
                user_id: user.id,
                course_id: courseId
            }])
            .select()
            .single();
            
        if (enrollmentError) {
            throw enrollmentError;
        }
        
        return { status: 201, body: enrollment };
    } catch (error) {
        context.log.error(error);
        return { status: 500, body: "Server error" };
    }
};
