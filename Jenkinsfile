// Declarative Jenkins Pipeline for the project
pipeline {
    agent any


    stages {
        stage('Checkout SCM') {
            steps {
                // Clone repository
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                // Install Node.js dependencies
                sh 'npm ci'
            }
        }

        stage('Lint') {
            steps {
                // Placeholder for linting; add scripts to package.json if needed
                sh 'echo "No lint script defined, skipping."'
            }
        }

        stage('Test') {
            steps {
                // Placeholder for tests; add 'test' script to package.json if needed
                sh 'echo "No test script defined, skipping."'
            }
        }

        stage('Archive Artifacts') {
            steps {
                // Archive generated response binaries, if any
                archiveArtifacts artifacts: 'responses/**/*.bin', allowEmptyArchive: true
            }
        }
        
        stage('Deploy') {
            steps {
                echo 'Deploying application with pm2'
                // Ensure workspace is up-to-date
                sh 'git pull'
                // Restart if running, otherwise start the server
                sh 'pm2 restart server.js || pm2 start server.js'
            }
        }
    }

    post {
        always {
            // Clean workspace after build
            cleanWs()
        }
    }
}