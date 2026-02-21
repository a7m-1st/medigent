"""
MedGemma Backend API Test Script
Tests the complete flow: chat_controller and task_controller endpoints
"""

import json
import sys
import time
import uuid
import requests
from typing import Optional

# Configuration
BASE_URL = "http://localhost:3001"
API_KEY = "AIzaSyAWAgmn53xlJPwoUtyecjrRClTP3Gj-VrQ"  # Replace with your actual API key
MODEL_PLATFORM = "GEMINI"
MODEL_TYPE = "GEMINI_3_FLASH"


def test_health():
    """Test 1: Health check endpoint"""
    print("=" * 60)
    print("TEST 1: Health Check")
    print("=" * 60)
    
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        if response.status_code == 200:
            print("Health check: PASSED")
            return True
        else:
            print("Health check: FAILED")
            return False
    except Exception as e:
        print(f"Health check ERROR: {e}")
        return False


def test_model_validation():
    """Test 2: Model validation endpoint"""
    print("\n" + "=" * 60)
    print("TEST 2: Model Validation")
    print("=" * 60)
    
    payload = {
        "model_platform": MODEL_PLATFORM,
        "model_type": MODEL_TYPE,
        "api_key": API_KEY,
        "url": None,
        "model_config_dict": None
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/model/validate",
            json=payload,
            timeout=60
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"Response: {json.dumps(result, indent=2)}")
            if result.get("is_valid") and result.get("is_tool_calls"):
                print("Model validation: PASSED")
                return True
            else:
                print(f"Model validation: FAILED - {result.get('message')}")
                return False
        else:
            print(f"Model validation: FAILED - {response.text}")
            return False
    except Exception as e:
        print(f"Model validation ERROR: {e}")
        return False


def test_start_chat_streaming():
    """Test 3: Start chat with SSE streaming"""
    print("\n" + "=" * 60)
    print("TEST 3: Start Chat (SSE Streaming)")
    print("=" * 60)
    
    # Generate unique IDs
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    project_id = f"proj-{uuid.uuid4().hex[:8]}"
    
    payload = {
        "task_id": task_id,
        "project_id": project_id,
        "question": "Create a simple Python script that prints 'Hello World' and save it to hello.py",
        "attaches": [],
        "model_platform": MODEL_PLATFORM,
        "model_type": MODEL_TYPE,
        "api_key": API_KEY,
        "api_url": None,
        "max_retries": 3,
        "installed_mcp": {"mcpServers": {}},
        "summary_prompt": ""
    }
    
    print(f"Task ID: {task_id}")
    print(f"Project ID: {project_id}")
    print(f"Question: {payload['question']}")
    
    try:
        response = requests.post(
            f"{BASE_URL}/chat",
            json=payload,
            stream=True,
            headers={"Accept": "text/event-stream"},
            timeout=300  # 5 minutes timeout for streaming
        )
        
        print(f"\nStreaming response (showing first 20 events):")
        print("-" * 60)
        
        event_count = 0
        collected_data = []
        
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    try:
                        data = json.loads(line_str[6:])  # Remove 'data: ' prefix
                        event_count += 1
                        collected_data.append(data)
                        
                        step = data.get('step', 'unknown')
                        step_data = data.get('data', {})
                        
                        # Print key events
                        if step == 'error':
                            print(f"[EVENT {event_count}] ERROR: {step_data}")
                        elif step == 'create_agent':
                            print(f"[EVENT {event_count}] Agent Created: {step_data.get('name', 'unknown')}")
                        elif step == 'activate_agent':
                            print(f"[EVENT {event_count}] Agent Activated: {step_data.get('name', 'unknown')}")
                        elif step == 'deactivate_agent':
                            print(f"[EVENT {event_count}] Agent Deactivated: {step_data.get('name', 'unknown')}")
                        elif step == 'ask':
                            print(f"[EVENT {event_count}] Agent Question: {step_data.get('question', 'unknown')}")
                        elif step == 'tool_call':
                            print(f"[EVENT {event_count}] Tool Call: {step_data.get('tool', 'unknown')}")
                        elif step == 'result':
                            print(f"[EVENT {event_count}] Result: {step_data.get('content', '')[:100]}...")
                        else:
                            print(f"[EVENT {event_count}] {step}: {str(step_data)[:100]}")
                        
                        # Stop after 20 events for demo
                        if event_count >= 20:
                            print("\n[Stopping after 20 events for demo...]")
                            break
                            
                    except json.JSONDecodeError:
                        print(f"[RAW] {line_str}")
        
        print("-" * 60)
        print(f"Total events received: {event_count}")
        print(f"\nStreaming test: PASSED")
        return project_id, task_id
        
    except Exception as e:
        print(f"Start chat ERROR: {e}")
        return None, None


def test_improve_chat(project_id: str):
    """Test 4: Improve/continue chat"""
    print("\n" + "=" * 60)
    print("TEST 4: Improve Chat")
    print("=" * 60)
    
    if not project_id:
        print("SKIP: No project_id available")
        return False
    
    payload = {
        "question": "Can you also add a function that takes a name parameter and says Hello to that name?",
        "task_id": f"task-{uuid.uuid4().hex[:8]}",
        "attaches": []
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/chat/{project_id}",
            json=payload,
            timeout=10
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 201:
            print("Improve chat: PASSED")
            return True
        else:
            print(f"Improve chat: FAILED - {response.text}")
            return False
    except Exception as e:
        print(f"Improve chat ERROR: {e}")
        return False


def test_human_reply(project_id: str):
    """Test 5: Human reply to agent"""
    print("\n" + "=" * 60)
    print("TEST 5: Human Reply")
    print("=" * 60)
    
    if not project_id:
        print("SKIP: No project_id available")
        return False
    
    payload = {
        "agent": "developer_agent",
        "reply": "Yes, please use type hints in the function signature"
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/chat/{project_id}/human-reply",
            json=payload,
            timeout=10
        )
        print(f"Status: {response.status_code}")
        print(f"Sent reply to: {payload['agent']}")
        
        if response.status_code == 201:
            print("Human reply: PASSED")
            return True
        else:
            print(f"Human reply: FAILED - {response.text}")
            return False
    except Exception as e:
        print(f"Human reply ERROR: {e}")
        return False


def test_stop_chat(project_id: str):
    """Test 6: Stop chat/task"""
    print("\n" + "=" * 60)
    print("TEST 6: Stop Chat")
    print("=" * 60)
    
    if not project_id:
        print("SKIP: No project_id available")
        return False
    
    try:
        response = requests.delete(
            f"{BASE_URL}/chat/{project_id}",
            timeout=10
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 204:
            print("Stop chat: PASSED")
            return True
        else:
            print(f"Stop chat: FAILED - {response.text}")
            return False
    except Exception as e:
        print(f"Stop chat ERROR: {e}")
        return False


def test_start_task(project_id: str):
    """Test 7: Start/resume task"""
    print("\n" + "=" * 60)
    print("TEST 7: Start Task")
    print("=" * 60)
    
    if not project_id:
        print("SKIP: No project_id available")
        return False
    
    try:
        response = requests.post(
            f"{BASE_URL}/task/{project_id}/start",
            timeout=10
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 201:
            print("Start task: PASSED")
            return True
        else:
            print(f"Start task: FAILED - {response.text}")
            return False
    except Exception as e:
        print(f"Start task ERROR: {e}")
        return False


def test_stop_all_tasks():
    """Test 8: Stop all tasks"""
    print("\n" + "=" * 60)
    print("TEST 8: Stop All Tasks")
    print("=" * 60)
    
    try:
        response = requests.delete(
            f"{BASE_URL}/task/stop-all",
            timeout=10
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 204:
            print("Stop all tasks: PASSED")
            return True
        else:
            print(f"Stop all tasks: FAILED - {response.text}")
            return False
    except Exception as e:
        print(f"Stop all tasks ERROR: {e}")
        return False


def main():
    """Main test runner"""
    print("\n" + "=" * 60)
    print("MedGemma Backend API Test Suite")
    print("=" * 60)
    print(f"Base URL: {BASE_URL}")
    print(f"Model: {MODEL_PLATFORM} / {MODEL_TYPE}")
    print("=" * 60)
    
    results = []
    project_id = None
    task_id = None
    
    # Test 1: Health check
    results.append(("Health Check", test_health()))
    
    # Test 2: Model validation (optional, can be skipped if no API key)
    if API_KEY and API_KEY != "your-api-key-here":
        results.append(("Model Validation", test_model_validation()))
    else:
        print("\n[!] Skipping Model Validation (no API key set)")
        results.append(("Model Validation", None))
    
    # Test 3: Start chat (main streaming test)
    project_id, task_id = test_start_chat_streaming()
    results.append(("Start Chat", project_id is not None))
    
    if project_id:
        # Small delay to let the task initialize
        time.sleep(2)
        
        # Test 4: Improve chat
        results.append(("Improve Chat", test_improve_chat(project_id)))
        
        # Test 5: Human reply
        results.append(("Human Reply", test_human_reply(project_id)))
        
        # Test 7: Start task (resume)
        results.append(("Start Task", test_start_task(project_id)))
        
        # Test 6: Stop chat
        results.append(("Stop Chat", test_stop_chat(project_id)))
    
    # Test 8: Stop all tasks (cleanup)
    results.append(("Stop All Tasks", test_stop_all_tasks()))
    
    # Print summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = 0
    failed = 0
    skipped = 0
    
    for test_name, result in results:
        if result is True:
            status = "PASSED"
            passed += 1
        elif result is False:
            status = "FAILED"
            failed += 1
        else:
            status = "SKIPPED"
            skipped += 1
        print(f"  {test_name:.<40} {status}")
    
    print("=" * 60)
    print(f"Total: {passed} passed, {failed} failed, {skipped} skipped")
    print("=" * 60)
    
    if failed > 0:
        sys.exit(1)
    else:
        print("\nAll tests completed successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
