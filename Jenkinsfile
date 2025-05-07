pipeline {
    agent any
    environment {
        NVM_DIR = "/var/lib/jenkins/.nvm"
        PATH = "/var/lib/jenkins/.nvm/versions/node/v22.15.0/bin:$PATH"
        GIT_REF = sh(script: '''
            if [ -n "$GIT_REF" ]; then
                echo "$GIT_REF" | sed 's#refs/tags/##' | sed 's#refs/heads/##'
            elif [ -n "$GIT_COMMIT" ]; then
                echo "$GIT_COMMIT"
            else
                echo "main"
            fi
        ''', returnStdout: true).trim()
    }
    stages {
        stage('Deploy') {
            steps {
                dir('/var/lib/jenkins/myownai') {
                    sh 'git pull origin main'
                    sh 'pm2 restart server.js'
                }
            }
        }
    }
}
